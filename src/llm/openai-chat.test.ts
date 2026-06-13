import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamEvent, LLMResponse } from "./client.js";
import type { ProviderMessage } from "./client.js";

async function collectStream(
  stream: AsyncGenerator<StreamEvent, LLMResponse, unknown>,
) {
  const events: StreamEvent[] = [];
  let result = await stream.next();
  while (!result.done) {
    events.push(result.value);
    result = await stream.next();
  }
  return { events, response: result.value };
}

function mockStream<T>(chunks: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < chunks.length) {
            return { value: chunks[index++], done: false };
          }
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}

const chatCreateMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: chatCreateMock,
        },
      };
    },
  };
});

import { OpenAIChatClient } from "./openai-chat.js";

describe("OpenAIChatClient", () => {
  beforeEach(() => {
    chatCreateMock.mockClear();
  });

  describe("streaming", () => {
    it("yields text deltas and returns final response", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "Hello" }, finish_reason: null }],
          },
          {
            choices: [{ delta: { content: " world" }, finish_reason: null }],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.events).toEqual([
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ]);
      expect(collected.response.stop_reason).toBe("end_turn");
      expect(collected.response.content).toEqual([
        { type: "text", text: "Hello world" },
      ]);
      expect(collected.response.usage).toEqual({
        input: { total: 10, cache_miss: 0, cache_hit: 0 },
        output: 5,
      });
    });

    it("yields thinking deltas from reasoning_content", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [
              {
                delta: { reasoning_content: "Let me think..." } as any,
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              { delta: { content: "The answer." }, finish_reason: null },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.events[0]).toEqual({
        type: "thinking",
        thinking: "Let me think...",
      });
      expect(collected.events[1]).toEqual({
        type: "text",
        text: "The answer.",
      });
      expect(collected.response.content[0]).toEqual({
        type: "thinking",
        thinking: "Let me think...",
      });
      expect(collected.response.content[1]).toEqual({
        type: "text",
        text: "The answer.",
      });
    });

    it("yields tool_use events after stream ends", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "Read", arguments: '{"path":"' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: 'test.ts"}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 20, completion_tokens: 8 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      const toolEvents = collected.events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      expect((toolEvents[0] as { type: "tool_use"; block: any }).block).toEqual(
        {
          type: "tool_use",
          id: "call_1",
          name: "Read",
          input: { path: "test.ts" },
        },
      );

      expect(collected.response.stop_reason).toBe("tool_use");
      expect(collected.response.content[0].type).toBe("tool_use");
    });

    it("handles multiple tool calls", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_a",
                      type: "function",
                      function: { name: "Read", arguments: '{"path":"a"}' },
                    },
                    {
                      index: 1,
                      id: "call_b",
                      type: "function",
                      function: { name: "Write", arguments: '{"path":"b"}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      const toolEvents = collected.events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(2);
      expect(collected.response.content).toHaveLength(2);
    });

    it("handles JSON parse failure on tool arguments", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "Test", arguments: "not-json" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      const toolBlock = (
        collected.events[0] as { type: "tool_use"; block: any }
      ).block;
      expect(toolBlock.input).toEqual({});
    });

    it("maps stop reasons correctly", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "truncated" }, finish_reason: null }],
          },
          {
            choices: [{ delta: {}, finish_reason: "length" }],
            usage: { prompt_tokens: 5, completion_tokens: 100 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.response.stop_reason).toBe("max_tokens");
    });

    it("handles empty usage", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "hi" }, finish_reason: null }],
          },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.response.usage).toEqual({
        input: { total: 0, cache_miss: 0, cache_hit: 0 },
        output: 0,
      });
    });
  });

  describe("message conversion", () => {
    it("prepends system message", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: null }],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          },
        ]),
      );

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream([], [], { system: "Be helpful" });
      await collectStream(stream);

      const params = chatCreateMock.mock.calls[0][0];
      expect(params.messages[0]).toEqual({
        role: "system",
        content: "Be helpful",
      });
    });

    it("converts tool results to individual tool messages", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: null }],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          },
        ]),
      );

      const messages: ProviderMessage[] = [
        { role: "user", content: "do something" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "Read", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "file content",
            },
          ],
        },
      ];

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream(messages, []);
      await collectStream(stream);

      const params = chatCreateMock.mock.calls[0][0];
      const toolMsg = params.messages.find((m: any) => m.role === "tool");
      expect(toolMsg).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "file content",
      });
    });

    it("drops thinking blocks from assistant messages", async () => {
      chatCreateMock.mockReturnValue(
        mockStream([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: null }],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          },
        ]),
      );

      const messages: ProviderMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning..." },
            { type: "text", text: "answer" },
          ],
        },
      ];

      const client = new OpenAIChatClient("test-key");
      const stream = client.chatStream(messages, []);
      await collectStream(stream);

      const params = chatCreateMock.mock.calls[0][0];
      const assistantMsg = params.messages.find(
        (m: any) => m.role === "assistant",
      );
      expect(assistantMsg.content).toBe("answer");
    });
  });
});
