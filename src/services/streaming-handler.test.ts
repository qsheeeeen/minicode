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
    if (resolveNext) { resolveNext({ value: chunk, done: false }); resolveNext = null; }
    else queue.push({ value: chunk, done: false });
  };
  events["contentBlock"] = (block: any) => {
    const chunk = { type: "contentBlock", block };
    if (resolveNext) { resolveNext({ value: chunk, done: false }); resolveNext = null; }
    else queue.push({ value: chunk, done: false });
  };
  events["end"] = () => {
    isDone = true;
    if (resolveNext) { resolveNext({ value: undefined, done: true }); resolveNext = null; }
    else queue.push({ value: undefined, done: true });
  };

  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (queue.length > 0) return queue.shift()!;
          if (isDone) return { value: undefined, done: true };
          return new Promise<IteratorResult<any>>((resolve) => {
            resolveNext = resolve;
          });
        }
      };
    },
    finalMessage: vi.fn(() => {
      events["end"]?.(); // finish the stream when final message is asked
      return Promise.resolve({ id: "msg-1", role: "assistant", content: [], model: "test", stop_reason: "end_turn", type: "message", usage: { input_tokens: 0, output_tokens: 0 } });
    }),
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

    // Simulate text delta then content block end
    events["text"]?.("Hello");
    events["contentBlock"]?.({ type: "text", text: "Hello" });
    events["end"]?.();

    const result = await promise;
    expect(result.toolCalls).toHaveLength(0);
    expect(store.setStreaming).toHaveBeenCalledWith(true);
    expect(saveStore).toHaveBeenCalled();
  });

  it("handles tool_use blocks", async () => {
    const store = mockStore();
    const saveStore = vi.fn();
    const toolDef = { name: "Read", description: "Read file", input_schema: {}, execute: vi.fn() };
    const tools = new Map([["Read", toolDef]]);
    const handler = new StreamingHandler(store, tools, saveStore);
    const events: Record<string, Function> = {};
    const stream = mockStream(events);

    const client = { chatStream: vi.fn().mockReturnValue(stream) } as any;
    const promise = handler.handle(client, [], [], {});

    events["tool_use"] = true; // mark for contentBlock
    events["contentBlock"]?.({
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
    const promise = handler.handle(client, [], [], undefined, undefined, streamRef);
    events["end"]?.();
    await promise;

    expect(streamRef.current).toBeNull();
    expect(store.setStreaming).toHaveBeenCalledWith(false);
  });
});
