import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingHandler } from "./streaming-handler.js";
import type { MessageStore } from "../messages.js";

function mockStore() {
  return {
    setStreaming: vi.fn(),
    appendToLastAssistantTurn: vi.fn(),
    getLastBlock: vi.fn().mockReturnValue(null),
    updateLastBlock: vi.fn(),
  } as unknown as MessageStore;
}

function mockStream(events: Record<string, Function>) {
  const queue: IteratorResult<any>[] = [];
  let resolveNext: ((v: IteratorResult<any>) => void) | null = null;
  let isDone = false;

  // Make the events available to tests to trigger yields
  events["text"] = (text: string) => {
    const chunk = { type: "text", text };
    if (resolveNext) {
      resolveNext({ value: chunk, done: false });
      resolveNext = null;
    } else queue.push({ value: chunk, done: false });
  };
  events["tool_use"] = (block: any) => {
    const chunk = { type: "tool_use", block };
    if (resolveNext) {
      resolveNext({ value: chunk, done: false });
      resolveNext = null;
    } else queue.push({ value: chunk, done: false });
  };
  events["end"] = () => {
    isDone = true;
    if (resolveNext) {
      resolveNext({
        value: { usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 } },
        done: true,
      });
      resolveNext = null;
    } else
      queue.push({
        value: { usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 } },
        done: true,
      });
  };

  return {
    async next() {
      if (queue.length > 0) return queue.shift()!;
      if (isDone)
        return {
          value: { usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 } },
          done: true,
        };
      return new Promise<IteratorResult<any>>((resolve) => {
        resolveNext = resolve;
      });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    finalMessage: vi
      .fn()
      .mockResolvedValue({ usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 } }),
    abort: vi.fn(),
  };
}

describe("StreamingHandler", () => {
  it("handles text delta events", async () => {
    const store = mockStore();
    const saveStore = vi.fn();
    const handler = new StreamingHandler(store, new Map(), saveStore);
    const events: Record<string, Function> = {};
    const stream = mockStream(events);

    const client = { chatStream: vi.fn().mockReturnValue(stream) } as any;
    const promise = handler.handle(client, [], [], {});

    // Simulate text delta then stream end
    events["text"]?.("Hello");
    events["end"]?.();

    const result = await promise;
    expect(result.toolCalls).toHaveLength(0);
    expect(store.setStreaming).toHaveBeenCalledWith(true);
    expect(saveStore).toHaveBeenCalled();
  });

  it("handles tool_use blocks", async () => {
    const store = mockStore();
    const saveStore = vi.fn();
    const toolDef = {
      name: "Read",
      description: "Read file",
      input_schema: {},
      execute: vi.fn(),
    };
    const tools = new Map([["Read", toolDef]]);
    const handler = new StreamingHandler(store, tools, saveStore);
    const events: Record<string, Function> = {};
    const stream = mockStream(events);

    const client = { chatStream: vi.fn().mockReturnValue(stream) } as any;
    const promise = handler.handle(client, [], [], {});

    events["tool_use"]?.({
      type: "tool_use",
      id: "tu-1",
      name: "Read",
      input: { path: "/foo" },
    });
    events["end"]?.();

    const result = await promise;
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].block.name).toBe("Read");
  });

  it("clears stream ref in finally", async () => {
    const store = mockStore();
    const saveStore = vi.fn();
    const handler = new StreamingHandler(store, new Map(), saveStore);
    const events: Record<string, Function> = {};
    const stream = mockStream(events);
    const streamRef = { current: stream };

    const client = { chatStream: vi.fn().mockReturnValue(stream) } as any;
    const promise = handler.handle(
      client,
      [],
      [],
      undefined,
      undefined,
      streamRef,
    );
    events["end"]?.();
    await promise;

    expect(streamRef.current).toBeNull();
    expect(store.setStreaming).toHaveBeenCalledWith(false);
  });
});
