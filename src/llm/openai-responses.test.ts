import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamEvent, LLMResponse } from "./client.js";
import type { MessageParam } from "../messages.js";

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

const responsesCreateMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      responses = {
        create: responsesCreateMock,
      };
    },
  };
});

import { OpenAIResponsesClient } from "./openai-responses.js";

describe("OpenAIResponsesClient", () => {
  beforeEach(() => {
    responsesCreateMock.mockClear();
  });

  describe("streaming", () => {
    it("yields text deltas and returns final response", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          { type: "response.output_text.delta", delta: "Hello" },
          { type: "response.output_text.delta", delta: " world" },
          { type: "response.output_text.done" },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "Hello world" },
                  ],
                },
              ],
              status: "completed",
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
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

    it("yields thinking deltas from reasoning events", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          { type: "response.reasoning.delta", delta: "thinking..." },
          { type: "response.reasoning.done" },
          { type: "response.output_text.delta", delta: "answer" },
          { type: "response.output_text.done" },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "reasoning",
                  summary: [
                    {
                      type: "summary_text",
                      summary_text: "thinking...",
                    },
                  ],
                },
                {
                  type: "message",
                  content: [{ type: "output_text", text: "answer" }],
                },
              ],
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 3 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.events[0]).toEqual({
        type: "thinking",
        thinking: "thinking...",
      });
      expect(collected.events[1]).toEqual({
        type: "text",
        text: "answer",
      });
      expect(collected.response.content[0].type).toBe("thinking");
      expect(collected.response.content[1].type).toBe("text");
    });

    it("yields tool_use events inline on output_item.done", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.output_text.delta",
            delta: "Let me read...",
          },
          { type: "response.output_text.done" },
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              id: "call_1",
              name: "Read",
              arguments: '{"path":"/tmp/test.ts"}',
              call_id: "call_1",
            },
          },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "function_call",
                  id: "call_1",
                  name: "Read",
                  arguments: '{"path":"/tmp/test.ts"}',
                  call_id: "call_1",
                },
              ],
              status: "completed",
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      const toolEvents = collected.events.filter(
        (e) => e.type === "tool_use",
      );
      expect(toolEvents).toHaveLength(1);
      expect(
        (toolEvents[0] as { type: "tool_use"; block: any }).block,
      ).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "Read",
        input: { path: "/tmp/test.ts" },
      });

      expect(collected.response.stop_reason).toBe("tool_use");
    });

    it("handles JSON parse failure with _raw fallback", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              id: "call_1",
              name: "Test",
              arguments: "not-json",
              call_id: "call_1",
            },
          },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "function_call",
                  id: "call_1",
                  name: "Test",
                  arguments: "not-json",
                  call_id: "call_1",
                },
              ],
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 2 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      const toolBlock = (
        collected.events[0] as { type: "tool_use"; block: any }
      ).block;
      expect(toolBlock.input).toEqual({ _raw: "not-json" });
    });

    it("returns fallback response when completed event missing", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.output_text.delta",
            delta: "partial",
          },
          { type: "response.output_text.done" },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.response.stop_reason).toBe("error");
      expect(collected.response.content).toEqual([]);
    });

    it("maps stop reasons from response status", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "message",
                  content: [
                    { type: "output_text", text: "truncated" },
                  ],
                },
              ],
              status: "incomplete",
              usage: { input_tokens: 5, output_tokens: 100 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.response.stop_reason).toBe("max_tokens");
    });
  });

  describe("message conversion", () => {
    it("converts tool results to function_call_output", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.completed",
            response: {
              output: [],
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 0 },
            },
          },
        ]),
      );

      const messages: MessageParam[] = [
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

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(messages, []);
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      const toolOutput = params.input.find(
        (i: any) => i.type === "function_call_output",
      );
      expect(toolOutput).toEqual({
        type: "function_call_output",
        call_id: "call_1",
        output: "file content",
      });
    });

    it("drops thinking blocks from assistant messages", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.completed",
            response: {
              output: [],
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 0 },
            },
          },
        ]),
      );

      const messages: MessageParam[] = [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning..." },
            { type: "text", text: "answer" },
          ],
        },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(messages, []);
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      const assistantItems = params.input.filter(
        (i: any) => i.role === "assistant",
      );
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].content).toBe("answer");
    });

    it("passes system prompt as instructions", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.completed",
            response: {
              output: [],
              status: "completed",
              usage: { input_tokens: 5, output_tokens: 0 },
            },
          },
        ]),
      );

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream([], [], {
        system: "Be helpful",
      });
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      expect(params.instructions).toBe("Be helpful");
    });
  });
});
