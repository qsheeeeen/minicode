import { describe, it, expect, beforeEach } from "vitest";
import { VirtualLLMClient } from "./virtual-llm.js";
import { createClient, registerProtocol } from "../llm/client.js";
import { resetProtocols } from "../llm/protocols/index.js";
import type { LLMStream } from "../llm/client.js";
import type { LLMAssistantBlock } from "../core/blocks.js";

// Helper: collect all events from a stream and return the final response
async function collectStream(stream: LLMStream) {
  const events: LLMAssistantBlock[] = [];
  let result = await stream.next();
  while (!result.done) {
    events.push(result.value);
    result = await stream.next();
  }
  return { events, result: result.value };
}

describe("VirtualLLMClient", () => {
  beforeEach(() => {
    resetProtocols();
  });

  describe("streaming contract", () => {
    it("yields stream events in order, then returns the response", async () => {
      const client = new VirtualLLMClient([
        {
          events: [
            { type: "text", text: "Hello" },
            { type: "text", text: " world" },
          ],
          result: {
            content: [{ type: "text", text: "Hello world" }],
            stop_reason: "end_turn",
            usage: {
              input: { total: 10, cache_miss: 5, cache_hit: 5 },
              output: 3,
            },
          },
        },
      ]);

      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.events).toHaveLength(2);
      expect(collected.events[0]).toEqual({ type: "text", text: "Hello" });
      expect(collected.events[1]).toEqual({ type: "text", text: " world" });
      expect(collected.result.stop_reason).toBe("end_turn");
      expect(collected.result.content[0]).toEqual({
        type: "text",
        text: "Hello world",
      });
    });

    it("works with for-await-of loop", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.textResponse("hi"),
      ]);

      const stream = client.chatStream([], []);
      const events: LLMAssistantBlock[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", text: "hi" });
    });

    it("yields thinking events", async () => {
      const client = new VirtualLLMClient([
        {
          events: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "text", text: "The answer is 42." },
          ],
          result: {
            content: [
              { type: "thinking", thinking: "Let me think..." },
              { type: "text", text: "The answer is 42." },
            ],
            stop_reason: "end_turn",
            usage: {
              input: { total: 10, cache_miss: 0, cache_hit: 10 },
              output: 5,
            },
          },
        },
      ]);

      const stream = client.chatStream([], []);
      const r1 = await stream.next();
      expect(r1.done).toBe(false);
      expect(r1.value).toEqual({
        type: "thinking",
        thinking: "Let me think...",
      });

      const r2 = await stream.next();
      expect(r2.done).toBe(false);
      expect(r2.value).toEqual({ type: "text", text: "The answer is 42." });

      const r3 = await stream.next();
      expect(r3.done).toBe(true);
    });
  });

  describe("sequential call consumption", () => {
    it("consumes scripted responses sequentially across multiple calls", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.textResponse("first"),
        VirtualLLMClient.textResponse("second"),
      ]);

      const stream1 = client.chatStream([{ role: "user", content: "q1" }], []);
      const events1 = await collectStream(stream1);
      expect(events1.result.content[0]).toEqual({
        type: "text",
        text: "first",
      });

      const stream2 = client.chatStream([{ role: "user", content: "q2" }], []);
      const events2 = await collectStream(stream2);
      expect(events2.result.content[0]).toEqual({
        type: "text",
        text: "second",
      });
    });
  });

  describe("thinking blocks in output", () => {
    it("preserves thinking blocks in response content", async () => {
      const client = new VirtualLLMClient([
        {
          events: [
            { type: "thinking", thinking: "reasoning..." },
            { type: "text", text: "answer" },
          ],
          result: {
            content: [
              { type: "thinking", thinking: "reasoning..." },
              { type: "text", text: "answer" },
            ],
            stop_reason: "end_turn",
            usage: {
              input: { total: 10, cache_miss: 0, cache_hit: 10 },
              output: 5,
            },
          },
        },
      ]);

      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.result.content).toHaveLength(2);
      expect(collected.result.content[0].type).toBe("thinking");
      expect(collected.result.content[1].type).toBe("text");
    });
  });

  describe("tool use", () => {
    it("yields tool_use events and returns them in the response", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.toolUseResponse("call_1", "Read", {
          path: "/tmp/test.ts",
        }),
      ]);

      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);

      expect(collected.events).toHaveLength(1);
      expect(collected.events[0].type).toBe("tool_use");
      const block = collected.events[0];
      if (block.type !== "tool_use") throw new Error("expected tool_use");
      expect(block.name).toBe("Read");
      expect(block.id).toBe("call_1");
      expect(block.input).toEqual({ path: "/tmp/test.ts" });

      expect(collected.result.stop_reason).toBe("tool_use");
      expect(collected.result.content[0].type).toBe("tool_use");
    });

    it("handles multiple tool_use events in a single response", async () => {
      const client = new VirtualLLMClient([
        {
          events: [
            {
              type: "tool_use",
              id: "a",
              name: "Read",
              input: { path: "a.ts" },
            },
            {
              type: "tool_use",
              id: "b",
              name: "Write",
              input: { path: "b.ts", content: "x" },
            },
          ],
          result: {
            content: [
              {
                type: "tool_use",
                id: "a",
                name: "Read",
                input: { path: "a.ts" },
              },
              {
                type: "tool_use",
                id: "b",
                name: "Write",
                input: { path: "b.ts", content: "x" },
              },
            ],
            stop_reason: "tool_use",
            usage: {
              input: { total: 100, cache_miss: 50, cache_hit: 50 },
              output: 10,
            },
          },
        },
      ]);

      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.events).toHaveLength(2);
      expect(collected.result.content).toHaveLength(2);
    });
  });

  describe("abort signal", () => {
    it("throws when signal is already aborted", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.textResponse("should not reach"),
      ]);

      const controller = new AbortController();
      controller.abort();

      const stream = client.chatStream([], [], {
        signal: controller.signal,
      });

      await expect(stream.next()).rejects.toThrow("Aborted");
    });

    it("throws when signal fires during streaming", async () => {
      const client = new VirtualLLMClient(
        [
          {
            events: [
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ],
            result: {
              content: [{ type: "text", text: "first second" }],
              stop_reason: "end_turn",
              usage: {
                input: { total: 1, cache_miss: 0, cache_hit: 1 },
                output: 2,
              },
            },
          },
        ],
        { yieldDelayMs: 1 },
      );

      const controller = new AbortController();
      const stream = client.chatStream([], [], {
        signal: controller.signal,
      });

      const first = await stream.next();
      expect(first.done).toBe(false);

      controller.abort();

      await expect(stream.next()).rejects.toThrow("Aborted");
    });
  });

  describe("error handling", () => {
    it("throws when all scripted responses are exhausted", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.textResponse("only one"),
      ]);

      const stream1 = client.chatStream([], []);
      await collectStream(stream1);

      expect(() => client.chatStream([], [])).toThrow(
        /VirtualLLMClient: no more scripted responses/,
      );
    });

    it("returns empty stream when exhaustThrows is false", async () => {
      const client = new VirtualLLMClient(
        [VirtualLLMClient.textResponse("only one")],
        { exhaustThrows: false },
      );

      const stream1 = client.chatStream([], []);
      await collectStream(stream1);

      const stream2 = client.chatStream([], []);
      const collected = await collectStream(stream2);
      expect(collected.result.content).toHaveLength(0);
      expect(collected.result.stop_reason).toBe("end_turn");
    });

    it("stream returns done after completion", async () => {
      const client = new VirtualLLMClient([
        VirtualLLMClient.textResponse("done"),
      ]);

      const stream = client.chatStream([], []);
      await stream.next();
      const final = await stream.next();
      expect(final.done).toBe(true);

      // Calling next() again should still return done
      const again = await stream.next();
      expect(again.done).toBe(true);
    });
  });

  describe("factory registration", () => {
    it("createClient returns VirtualLLMClient after registration", () => {
      registerProtocol(
        "virtual",
        () =>
          new VirtualLLMClient([VirtualLLMClient.textResponse("from factory")]),
      );

      const client = createClient("virtual");
      expect(client).toBeInstanceOf(VirtualLLMClient);
    });

    it("createClient with virtual protocol produces working stream", async () => {
      registerProtocol(
        "virtual",
        () =>
          new VirtualLLMClient([
            VirtualLLMClient.textResponse("factory hello"),
          ]),
      );

      const client = createClient("virtual");
      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.result.content[0]).toEqual({
        type: "text",
        text: "factory hello",
      });
    });
  });

  describe("options", () => {
    it("yields with artificial delay when yieldDelayMs is set", async () => {
      const client = new VirtualLLMClient(
        [VirtualLLMClient.textResponse("delayed")],
        { yieldDelayMs: 50 },
      );

      const start = Date.now();
      const stream = client.chatStream([], []);
      await collectStream(stream);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("handles empty events array (immediate response return)", async () => {
      const client = new VirtualLLMClient([
        {
          events: [],
          result: {
            content: [],
            stop_reason: "end_turn",
            usage: {
              input: { total: 1, cache_miss: 0, cache_hit: 1 },
              output: 0,
            },
          },
        },
      ]);

      const stream = client.chatStream([], []);
      const collected = await collectStream(stream);
      expect(collected.events).toHaveLength(0);
      expect(collected.result.stop_reason).toBe("end_turn");
    });
  });
});
