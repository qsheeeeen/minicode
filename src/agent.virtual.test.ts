import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgent, type AgentDeps } from "./agent.js";
import { Model } from "./llm/model.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  toolUseResponse,
  createVirtualTool,
} from "./testing/index.js";
import type { ScriptedResponse } from "./testing/index.js";

import {
  createCapabilities,
  type ToolDef,
  type UserPrompter,
} from "./tools/registry.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { RuntimeEvents } from "./services/runtime-events.js";
import { PromptManager } from "./services/prompt-manager.js";
import { ToolExecutor } from "./tools/executor.js";
import { PermissionService } from "./services/permission.js";
import { SessionPersistence } from "./services/session-persistence.js";
import { createPermissionGate } from "./app/tool-gates.js";
import { SteeringQueue } from "./services/steering-queue.js";

vi.mock("./utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));

/** Expected-shape helper: user blocks now carry stable ids, so deep-equal
 *  assertions match on the invariant fields only. */
const userBlock = (text: string) =>
  expect.objectContaining({ type: "user", text }) as any;

function createTestDeps(options?: {
  responses?: ScriptedResponse[];
  tools?: Map<string, ToolDef>;
  permissionMode?: "manual" | "yolo" | "auto";
  steering?: SteeringQueue;
}) {
  const responses = options?.responses ?? [defaultTextResponse("OK")];
  const client = new VirtualLLMClient(responses);
  const tools =
    options?.tools ??
    new Map<string, ToolDef>([
      [
        "VirtualTool",
        createVirtualTool(
          "VirtualTool",
          (args) => `result: ${JSON.stringify(args)}`,
        ),
      ],
    ]);
  const model = new Model("test-model", "test-provider", 200000);
  const runtimeEvents = new RuntimeEvents();
  const sessionManager = new SessionManager(
    undefined,
    undefined,
    runtimeEvents,
  );
  const contextManager = new ContextManager({
    getClient: () => client,
    getModel: () => model,
    getContext: () => sessionManager.getContext(),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    setActiveMessageId: (id) => sessionManager.setActiveMessageId(id),
    events: runtimeEvents,
    compressionThresholdRatio: 0.8,
  });
  const promptManager = new PromptManager();
  const toolExecutor = new ToolExecutor({
    tools,
    beforeHooks: [
      createPermissionGate(
        new PermissionService(options?.permissionMode ?? "yolo"),
      ),
    ],
    context: sessionManager.getContext(),
    capabilities: createCapabilities([]),
  });
  const deps: AgentDeps = {
    client,
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
    ...(options?.steering ? { steering: options.steering } : {}),
  };

  return { deps, context: sessionManager.getContext() };
}

/** A tool-use response whose stream terminated at the output token limit —
 *  the batch must not execute. */
function truncatedToolUseResponse(
  toolId: string,
  toolName: string,
  input: Record<string, unknown>,
): ScriptedResponse {
  return {
    events: [{ type: "tool_use", id: toolId, name: toolName, input }],
    result: {
      ok: true,
      content: [{ type: "tool_use", id: toolId, name: toolName, input }],
      stop_reason: "max_tokens",
      usage: { input: { total: 10, cache_miss: 0, cache_hit: 0 }, output: 10 },
    },
  };
}

describe("runAgent virtual integration", () => {
  beforeEach(() => {
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-agent-virtual-test",
    );
  });

  it("converts a provider fault terminal into a TurnFaultError", async () => {
    const { deps } = createTestDeps({
      responses: [
        VirtualLLMClient.faultResponse({
          kind: "llm",
          reason: "rate limited",
          retryable: true,
        }),
      ],
    });

    await expect(
      runAgent(deps, "Hi", new AbortController().signal),
    ).rejects.toMatchObject({
      name: "TurnFaultError",
      message: "LLM error (retryable): rate limited",
    });
  });

  it("scenario 1: pure text — LLM returns text, run ends, context has correct messages", async () => {
    const { deps, context } = createTestDeps({
      responses: [defaultTextResponse("Hello, I am the agent.")],
    });

    await runAgent(deps, "Hi there", new AbortController().signal);

    expect(context.getBlocks()).toEqual([
      userBlock("Hi there"),
      { type: "text", text: "Hello, I am the agent." },
    ]);
  });

  it("scenario 2: tool call — LLM tool_use, virtual tool executes, tool_result, LLM text reply", async () => {
    const virtualTool = createVirtualTool(
      "Echo",
      (args) => `echoed: ${args.input}`,
    );
    const tools = new Map([["Echo", virtualTool]]);

    const { deps, context } = createTestDeps({
      responses: [
        toolUseResponse("call_1", "Echo", { input: "hello" }),
        defaultTextResponse("The tool said: echoed: hello"),
      ],
      tools,
    });

    await runAgent(deps, "Use the Echo tool", new AbortController().signal);

    expect(context.getBlocks()).toEqual([
      userBlock("Use the Echo tool"),
      {
        type: "tool_use",
        id: "call_1",
        name: "Echo",
        input: { input: "hello" },
      },
      { type: "tool_result", tool_use_id: "call_1", content: "echoed: hello" },
      { type: "text", text: "The tool said: echoed: hello" },
    ]);
  });

  it("scenario 3: multi-tool chain — tool A, tool B, text reply, verify order", async () => {
    const callOrder: string[] = [];
    const toolA = createVirtualTool("ToolA", (args) => {
      callOrder.push("A");
      return `A-result: ${args.q}`;
    });
    const toolB = createVirtualTool("ToolB", (args) => {
      callOrder.push("B");
      return `B-result: ${args.q}`;
    });
    const tools = new Map<string, ToolDef>([
      ["ToolA", toolA],
      ["ToolB", toolB],
    ]);

    const { deps, context } = createTestDeps({
      responses: [
        // LLM requests both tools in one response
        {
          events: [
            {
              type: "tool_use",
              id: "call_a",
              name: "ToolA",
              input: { q: "1" },
            },
            {
              type: "tool_use",
              id: "call_b",
              name: "ToolB",
              input: { q: "2" },
            },
          ],
          result: {
            ok: true,
            content: [
              {
                type: "tool_use",
                id: "call_a",
                name: "ToolA",
                input: { q: "1" },
              },
              {
                type: "tool_use",
                id: "call_b",
                name: "ToolB",
                input: { q: "2" },
              },
            ],
            stop_reason: "tool_use",
            usage: {
              input: { total: 100, cache_miss: 50, cache_hit: 50 },
              output: 10,
            },
          },
        },
        defaultTextResponse("Both tools done."),
      ],
      tools,
    });

    await runAgent(deps, "Run both tools", new AbortController().signal);

    // Verify tool execution order
    expect(callOrder).toEqual(["A", "B"]);

    expect(context.getBlocks()).toEqual([
      userBlock("Run both tools"),
      {
        type: "tool_use",
        id: "call_a",
        name: "ToolA",
        input: { q: "1" },
      },
      {
        type: "tool_use",
        id: "call_b",
        name: "ToolB",
        input: { q: "2" },
      },
      { type: "tool_result", tool_use_id: "call_a", content: "A-result: 1" },
      { type: "tool_result", tool_use_id: "call_b", content: "B-result: 2" },
      { type: "text", text: "Both tools done." },
    ]);
  });

  it("steering: queued text keeps the loop alive when the model had nothing left to do", async () => {
    const steering = new SteeringQueue();
    const { deps, context } = createTestDeps({
      steering,
      responses: [
        defaultTextResponse("first answer"),
        defaultTextResponse("steered answer"),
      ],
    });

    const runPromise = runAgent(deps, "start", new AbortController().signal);
    // Queue while the first response is being consumed.
    steering.enqueue("and then do this too");
    await runPromise;

    expect(context.getBlocks()).toEqual([
      userBlock("start"),
      { type: "text", text: "first answer" },
      userBlock("and then do this too"),
      { type: "text", text: "steered answer" },
    ]);
  });

  it("steering: queued text injects between tool iterations", async () => {
    const steering = new SteeringQueue();
    let calls: string[] = [];
    const tools = new Map<string, ToolDef>([
      [
        "VirtualTool",
        createVirtualTool("VirtualTool", (args) => {
          calls.push(String((args as { tag?: string }).tag ?? ""));
          return "ok";
        }),
      ],
    ]);
    const { deps, context } = createTestDeps({
      steering,
      tools,
      responses: [
        toolUseResponse("call_1", "VirtualTool", { tag: "first" }),
        defaultTextResponse("done with everything"),
      ],
    });

    const runPromise = runAgent(deps, "run the tool", new AbortController().signal);
    steering.enqueue("while you are at it, also this");
    await runPromise;

    expect(calls).toEqual(["first"]);
    const blocks = context.getBlocks();
    // The steered user message lands after the tool round, before the final
    // answer — the second LLM call saw it.
    expect(blocks).toEqual([
      userBlock("run the tool"),
      { type: "tool_use", id: "call_1", name: "VirtualTool", input: { tag: "first" } },
      { type: "tool_result", tool_use_id: "call_1", content: "ok" },
      userBlock("while you are at it, also this"),
      { type: "text", text: "done with everything" },
    ]);
  });

  it("steering: abort drops queued/injected messages and truncates the run", async () => {
    const steering = new SteeringQueue();
    const { deps, context } = createTestDeps({
      steering,
      responses: [defaultTextResponse("never mind")],
    });

    steering.enqueue("queued but never mind");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(runAgent(deps, "start", ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(context.getBlocks()).toEqual([]);
    expect(steering.size).toBe(0);
  });

  it("max_tokens truncation: tool calls are not executed, error results let the model re-issue", async () => {
    let executions = 0;
    const tools = new Map<string, ToolDef>([
      [
        "VirtualTool",
        createVirtualTool("VirtualTool", (args) => {
          executions++;
          return `result: ${JSON.stringify(args)}`;
        }),
      ],
    ]);
    const { deps, context } = createTestDeps({
      tools,
      responses: [
        truncatedToolUseResponse("call_1", "VirtualTool", { q: "half" }),
        defaultTextResponse("Re-issued after truncation."),
      ],
    });

    await runAgent(deps, "run the tool", new AbortController().signal);

    expect(executions).toBe(0);
    expect(context.getBlocks()).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "call_1",
        content: expect.stringContaining("may be truncated"),
      }),
    );
    expect(context.getBlocks()).toContainEqual({
      type: "text",
      text: "Re-issued after truncation.",
    });
  });

  it("max_tokens truncation: stops after too many consecutive truncated rounds", async () => {
    let executions = 0;
    const tools = new Map<string, ToolDef>([
      [
        "VirtualTool",
        createVirtualTool("VirtualTool", () => {
          executions++;
          return "done";
        }),
      ],
    ]);
    const { deps, context } = createTestDeps({
      tools,
      responses: [
        truncatedToolUseResponse("call_1", "VirtualTool", {}),
        truncatedToolUseResponse("call_2", "VirtualTool", {}),
        truncatedToolUseResponse("call_3", "VirtualTool", {}),
        truncatedToolUseResponse("call_4", "VirtualTool", {}),
      ],
    });

    await runAgent(deps, "run the tool forever", new AbortController().signal);

    expect(executions).toBe(0);
    // Every truncated tool_use still gets a result (no dangling tool_use),
    // including the round that tripped the cap.
    const results = context
      .getBlocks()
      .filter((b) => b.type === "tool_result");
    expect(results).toHaveLength(4);
  });

  it("scenario 4: permission rejection — requiresPermission tool in manual mode, user rejects", async () => {
    const dangerousTool = createVirtualTool("Dangerous", () => "destroyed", {
      requiresPermission: true,
      readOnly: false,
    });
    const tools = new Map<string, ToolDef>([["Dangerous", dangerousTool]]);

    const prompter: UserPrompter = { prompt: async () => "no" };

    const model = new Model("test-model", "test-provider", 200000);
    const client = new VirtualLLMClient([
      toolUseResponse("call_1", "Dangerous", { action: "delete" }),
      defaultTextResponse("Understood, I will not run that tool."),
    ]);
    const runtimeEvents = new RuntimeEvents();
    const sessionManager = new SessionManager(
      undefined,
      undefined,
      runtimeEvents,
    );
    const contextManager = new ContextManager({
      getClient: () => client,
      getModel: () => model,
      getContext: () => sessionManager.getContext(),
      getChangeJournal: () => sessionManager.getChangeJournal(),
      setActiveUserMessageOrdinal: (ordinal) =>
        sessionManager.setActiveUserMessageOrdinal(ordinal),
      events: runtimeEvents,
      compressionThresholdRatio: 0.8,
    });
    const promptManager = new PromptManager();
    const toolExecutor = new ToolExecutor({
      tools,
      beforeHooks: [
        createPermissionGate(new PermissionService("manual")),
      ],
      context: sessionManager.getContext(),
      capabilities: createCapabilities([]),
    });
    const deps: AgentDeps = {
      client,
      model,
      sessionManager,
      contextManager,
      toolExecutor,
      promptManager,
    };
    const context = sessionManager.getContext();

    await runAgent(
      deps,
      "Do something dangerous",
      new AbortController().signal,
      { prompter },
    );

    expect(context.getBlocks()).toEqual([
      userBlock("Do something dangerous"),
      {
        type: "tool_use",
        id: "call_1",
        name: "Dangerous",
        input: { action: "delete" },
      },
      {
        type: "tool_result",
        tool_use_id: "call_1",
        content: "Error: User rejected",
      },
      { type: "text", text: "Understood, I will not run that tool." },
    ]);
  });
});
