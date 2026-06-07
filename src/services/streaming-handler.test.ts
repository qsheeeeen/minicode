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
  return {
    on: vi.fn((event: string, handler: Function) => { events[event] = handler; }),
    finalMessage: vi.fn(() => Promise.resolve({ id: "msg-1", role: "assistant", content: [], model: "test", stop_reason: "end_turn", type: "message", usage: { input_tokens: 0, output_tokens: 0 } })),
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

    const result = await promise;
    expect(result.hasToolCalls).toBe(false);
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

    const result = await promise;
    expect(result.hasToolCalls).toBe(true);
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
    await handler.handle(client, [], [], undefined, undefined, streamRef);

    expect(streamRef.current).toBeNull();
    expect(store.setStreaming).toHaveBeenCalledWith(false);
  });
});
