import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "./agent.js";
import { Model } from "./llm/model.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  toolUseResponse,
} from "./llm/virtual.js";
import type { ScriptedResponse } from "./llm/virtual.js";
import { createVirtualTool } from "./testing.js";

import type { ToolDef, UserPrompter } from "./tools/registry.js";
import { SessionManager } from "./services/session-manager.js";
import { ContextManager } from "./services/context-manager.js";
import { PromptManager } from "./services/prompt-manager.js";
import { ToolExecutor } from "./tools/executor.js";
import { PermissionService } from "./services/permission.js";
import { SessionPersistence } from "./services/session-persistence.js";
import { Signal } from "./utils/signal.js";

function createTestAgent(options?: {
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
  const tokenCount$ = new Signal(0);
  const sessionManager = new SessionManager();
  const contextManager = new ContextManager({
    contextLength: model.getContextLength(),
    compressionThresholdRatio: 0.8,
    tokenCount$,
    contextManager: sessionManager.getHistory(),
    statusReporter: sessionManager.reportStatus.bind(sessionManager),
  });
  const promptManager = new PromptManager();
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService: new PermissionService(options?.permissionMode ?? "yolo"),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    context: sessionManager.getHistory(),
  });
  const agent = new Agent({
    client,
    model,
    sessionManager,
    contextManager,
    toolExecutor,
    promptManager,
    tokenCount$,
  });

  return { agent, context: sessionManager.getHistory() };
}

describe("Agent virtual integration", () => {
  beforeEach(() => {
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-agent-virtual-test",
    );
  });

  it("scenario 1: pure text — LLM returns text, run ends, context has correct messages", async () => {
    const { agent, context } = createTestAgent({
      responses: [defaultTextResponse("Hello, I am the agent.")],
    });

    const completed = await agent.run("Hi there");
    expect(completed).toBe(true);

    const turns = context.getTurns();
    expect(turns).toEqual([
      {
        userText: "Hi there",
        process: [],
        assistantText: "Hello, I am the agent.",
      },
    ]);
  });

  it("scenario 2: tool call — LLM tool_use, virtual tool executes, tool_result, LLM text reply", async () => {
    const virtualTool = createVirtualTool(
      "Echo",
      (args) => `echoed: ${args.input}`,
    );
    const tools = new Map([["Echo", virtualTool]]);

    const { agent, context } = createTestAgent({
      responses: [
        toolUseResponse("call_1", "Echo", { input: "hello" }),
        defaultTextResponse("The tool said: echoed: hello"),
      ],
      tools,
    });

    const completed = await agent.run("Use the Echo tool");
    expect(completed).toBe(true);

    const turns = context.getTurns();
    expect(turns).toEqual([
      {
        userText: "Use the Echo tool",
        process: [
          {
            type: "tool_call",
            id: "call_1",
            name: "Echo",
            input: { input: "hello" },
            result: "echoed: hello",
          },
        ],
        assistantText: "The tool said: echoed: hello",
      },
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

    const { agent, context } = createTestAgent({
      responses: [
        // LLM requests both tools in one response
        {
          events: [
            {
              type: "tool_use",
              block: {
                type: "tool_use",
                id: "call_a",
                name: "ToolA",
                input: { q: "1" },
              },
            },
            {
              type: "tool_use",
              block: {
                type: "tool_use",
                id: "call_b",
                name: "ToolB",
                input: { q: "2" },
              },
            },
          ],
          response: {
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

    const completed = await agent.run("Run both tools");
    expect(completed).toBe(true);

    // Verify tool execution order
    expect(callOrder).toEqual(["A", "B"]);

    const turns = context.getTurns();
    expect(turns).toEqual([
      {
        userText: "Run both tools",
        process: [
          {
            type: "tool_call",
            id: "call_a",
            name: "ToolA",
            input: { q: "1" },
            result: "A-result: 1",
          },
          {
            type: "tool_call",
            id: "call_b",
            name: "ToolB",
            input: { q: "2" },
            result: "B-result: 2",
          },
        ],
        assistantText: "Both tools done.",
      },
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
    const tokenCount$ = new Signal(0);
    const sessionManager = new SessionManager();
    const contextManager = new ContextManager({
      contextLength: model.getContextLength(),
      compressionThresholdRatio: 0.8,
      tokenCount$,
      contextManager: sessionManager.getHistory(),
      statusReporter: sessionManager.reportStatus.bind(sessionManager),
    });
    const promptManager = new PromptManager();
    const toolExecutor = new ToolExecutor({
      tools,
      permissionService: new PermissionService("manual"),
      getChangeJournal: () => sessionManager.getChangeJournal(),
      context: sessionManager.getHistory(),
    });
    const agent = new Agent({
      client,
      model,
      sessionManager,
      contextManager,
      toolExecutor,
      promptManager,
      tokenCount$,
    });
    const context = sessionManager.getHistory();
    const reportStatusSpy = vi.spyOn(sessionManager, "reportStatus");

    const completed = await agent.run("Do something dangerous", { prompter });
    expect(completed).toBe(true);

    const turns = context.getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].process).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "Dangerous",
        input: { action: "delete" },
        result: "User rejected",
      },
    ]);

    // Status message should indicate denial
    expect(reportStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "error",
        content: expect.stringContaining("denied by user"),
      }),
    );
  });
});
