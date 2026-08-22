import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMAssistantBlock, LLMStreamResult } from "../client.js";

async function collectStream(
  stream: AsyncGenerator<LLMAssistantBlock, LLMStreamResult, unknown>,
) {
  const events: LLMAssistantBlock[] = [];
  let result = await stream.next();
  while (!result.done) {
    events.push(result.value);
    result = await stream.next();
  }
  return { events, result: result.value };
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
import { Model } from "../model.js";

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
                  content: [{ type: "output_text", text: "Hello world" }],
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
      expect(collected.result.stop_reason).toBe("end_turn");
      expect(collected.result.content).toEqual([
        { type: "text", text: "Hello world" },
      ]);
      expect(collected.result.usage).toEqual({
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
      expect(collected.result.content[0].type).toBe("thinking");
      expect(collected.result.content[1].type).toBe("text");
    });

    it("passes thinking blocks back as reasoning input items", async () => {
      responsesCreateMock.mockReturnValue(mockStream([]));
      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(
        [
          { type: "user", text: "hi" },
          { type: "thinking", thinking: "reasoning text" },
          { type: "text", text: "answer" },
        ],
        [],
        {},
      );
      await stream.next();

      expect(responsesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [
            { role: "user", content: "hi" },
            {
              type: "reasoning",
              content: [{ type: "reasoning_text", text: "reasoning text" }],
            },
            { role: "assistant", content: "answer" },
          ],
        }),
        expect.anything(),
      );
    });

    it("yields thinking deltas from reasoning_text events", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          { type: "response.reasoning_text.delta", delta: "think..." },
          { type: "response.reasoning_text.done" },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "reasoning",
                  content: [{ type: "reasoning_text", text: "think..." }],
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
        thinking: "think...",
      });
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

      const toolEvents = collected.events.filter((e) => e.type === "tool_use");
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "Read",
        input: { path: "/tmp/test.ts" },
      });

      expect(collected.result.stop_reason).toBe("tool_use");
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

      const toolBlock = collected.events[0];
      if (toolBlock.type !== "tool_use") throw new Error("expected tool_use");
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

      expect(collected.result).toEqual({
        ok: false,
        fault: {
          kind: "llm",
          reason: "stream ended without a completed event",
          retryable: true,
        },
      });
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
                  content: [{ type: "output_text", text: "truncated" }],
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
      expect(collected.result.stop_reason).toBe("max_tokens");
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

      const blocks = [
        { type: "tool_use" as const, id: "call_1", name: "Read", input: {} },
        {
          type: "tool_result" as const,
          tool_use_id: "call_1",
          content: "file content",
        },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, []);
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

    it("flushes tool_result images into a following user item for vision models", async () => {
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

      const blocks = [
        { type: "user" as const, text: "look" },
        { type: "tool_use" as const, id: "call_1", name: "Read", input: {} },
        {
          type: "tool_result" as const,
          tool_use_id: "call_1",
          content: "[image: shot.png]",
          images: [{ mediaType: "image/png" as const, base64: "AAAA" }],
        },
        { type: "text" as const, text: "the answer" },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, [], {
        model: new Model("m", "p", 1000, undefined, undefined, true),
      });
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      expect(params.input).toEqual([
        { role: "user", content: "look" },
        {
          type: "function_call",
          id: "call_1",
          name: "Read",
          arguments: "{}",
          call_id: "call_1",
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "[image: shot.png]",
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "[images from tool results]" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,AAAA",
              detail: "auto",
            },
          ],
        },
        { role: "assistant", content: "the answer" },
      ]);
    });

    it("strips tool_result images for non-vision models", async () => {
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

      const blocks = [
        { type: "user" as const, text: "look" },
        {
          type: "tool_result" as const,
          tool_use_id: "call_1",
          content: "[image: shot.png]",
          images: [{ mediaType: "image/png" as const, base64: "AAAA" }],
        },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, [], {
        model: new Model("m", "p", 1000, undefined, undefined, false),
      });
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      const imageItems = params.input.filter(
        (i: any) =>
          Array.isArray(i.content) &&
          i.content.some((p: any) => p.type === "input_image"),
      );
      expect(imageItems).toHaveLength(0);
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

      const blocks = [
        { type: "thinking" as const, thinking: "reasoning..." },
        { type: "text" as const, text: "answer" },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, []);
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      const assistantItems = params.input.filter(
        (i: any) => i.role === "assistant",
      );
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].content).toBe("answer");
    });

    it("uses the provider call_id as the tool id for round-trips", async () => {
      responsesCreateMock.mockReturnValue(
        mockStream([
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              id: "item-uuid-1",
              call_id: "call_00_real123",
              name: "Read",
              arguments: "{}",
            },
          },
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

      const blocks = [
        {
          type: "tool_use" as const,
          id: "call_00_real123",
          name: "Read",
          input: {},
        },
        {
          type: "tool_result" as const,
          tool_use_id: "call_00_real123",
          content: "file content",
        },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, []);
      const collected = await collectStream(stream);

      const toolEvent = collected.events.find((e) => e.type === "tool_use");
      if (toolEvent?.type !== "tool_use") throw new Error("expected tool_use");
      expect(toolEvent.id).toBe("call_00_real123");

      const params = responsesCreateMock.mock.calls[0][0];
      const fc = params.input.find((i: any) => i.type === "function_call");
      const output = params.input.find(
        (i: any) => i.type === "function_call_output",
      );
      expect(fc).toMatchObject({
        type: "function_call",
        id: "call_00_real123",
        call_id: "call_00_real123",
      });
      expect(output).toMatchObject({
        type: "function_call_output",
        call_id: "call_00_real123",
      });
    });

    it("falls back to the item id when no provider call_id exists", async () => {
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

      const blocks = [
        { type: "tool_use" as const, id: "call_1", name: "Read", input: {} },
        {
          type: "tool_result" as const,
          tool_use_id: "call_1",
          content: "file content",
        },
      ];

      const client = new OpenAIResponsesClient("test-key");
      const stream = client.chatStream(blocks, []);
      await collectStream(stream);

      const params = responsesCreateMock.mock.calls[0][0];
      const fc = params.input.find((i: any) => i.type === "function_call");
      const output = params.input.find(
        (i: any) => i.type === "function_call_output",
      );
      expect(fc).toMatchObject({ call_id: "call_1" });
      expect(output).toMatchObject({ call_id: "call_1" });
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
