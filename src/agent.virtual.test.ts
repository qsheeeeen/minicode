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

vi.mock("./utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));

function createTestDeps(options?: {
  responses?: ScriptedResponse[];
  tools?: Map<string, ToolDef>;
  permissionMode?: "manual" | "yolo" | "auto";
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
    setActiveUserMessageOrdinal: (ordinal) =>
      sessionManager.setActiveUserMessageOrdinal(ordinal),
    events: runtimeEvents,
    compressionThresholdRatio: 0.8,
  });
  const promptManager = new PromptManager();
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService: new PermissionService(options?.permissionMode ?? "yolo"),
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

  return { deps, context: sessionManager.getContext() };
}

describe("runAgent virtual integration", () => {
  beforeEach(() => {
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-agent-virtual-test",
    );
  });

  it("scenario 1: pure text — LLM returns text, run ends, context has correct messages", async () => {
    const { deps, context } = createTestDeps({
      responses: [defaultTextResponse("Hello, I am the agent.")],
    });

    await runAgent(deps, "Hi there", new AbortController().signal);

    expect(context.getBlocks()).toEqual([
      { type: "user", text: "Hi there" },
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
      { type: "user", text: "Use the Echo tool" },
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
      { type: "user", text: "Run both tools" },
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
      permissionService: new PermissionService("manual"),
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
      { type: "user", text: "Do something dangerous" },
      {
        type: "tool_use",
        id: "call_1",
        name: "Dangerous",
        input: { action: "delete" },
      },
      { type: "tool_result", tool_use_id: "call_1", content: "User rejected" },
    ]);
  });
});
