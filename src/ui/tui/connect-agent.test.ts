import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runAgent, type AgentDeps } from "../../agent.js";
import { Model } from "../../llm/model.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  createVirtualTool,
} from "../../testing/index.js";
import { createCapabilities, type ToolDef } from "../../tools/registry.js";
import { SessionManager } from "../../services/session-manager.js";
import { ContextManager } from "../../services/context-manager.js";
import { RuntimeEvents } from "../../services/runtime-events.js";
import { PromptManager } from "../../services/prompt-manager.js";
import { ToolExecutor } from "../../tools/executor.js";
import { PermissionService } from "../../services/permission.js";
import { SessionPersistence } from "../../services/session-persistence.js";
import { AgentRegistry } from "../../services/agent-registry.js";
import { connectAgent } from "./connect-agent.js";
import { useTuiState, initialState } from "./state.js";
import { UITimeline } from "./timeline.js";

function createTestDeps(responses = [defaultTextResponse("OK")]) {
  const tools = new Map<string, ToolDef>([
    [
      "VirtualTool",
      createVirtualTool(
        "VirtualTool",
        (args) => `result: ${JSON.stringify(args)}`,
      ),
    ],
  ]);
  const client = new VirtualLLMClient(responses);
  const model = new Model("test-model", "test-provider", 200000);
  const runtimeEvents = new RuntimeEvents();
  const sessionManager = new SessionManager(
    undefined,
    undefined,
    runtimeEvents,
  );
  const contextManager = new ContextManager({
    client,
    model,
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
    permissionService: new PermissionService("yolo"),
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
  return { deps, sessionManager, contextManager, runtimeEvents };
}

describe("connectAgent", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    useTuiState.setState(initialState);
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-connect-agent-test",
    );
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  it("should update messages with assistant text after runAgent()", async () => {
    const { deps, sessionManager, contextManager, runtimeEvents } =
      createTestDeps([defaultTextResponse("Hello from assistant!")]);
    const registry = new AgentRegistry();

    const result = connectAgent({
      sessionManager,
      contextManager,
      runtimeEvents,
      uiTimeline: new UITimeline(sessionManager.getContext()),
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    // Run the agent
    await runAgent(deps, "Hi there", new AbortController().signal);

    // Verify UI state received messages.
    const state = useTuiState.getState();

    // Should have at least user + assistant messages
    expect(state.messages.length).toBeGreaterThanOrEqual(2);

    // Find the user message
    const userMsg = state.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("Hi there");

    // Find the assistant text message
    const textMsg = state.messages.find((m) => m.role === "text");
    expect(textMsg).toBeDefined();
    expect(textMsg!.content).toBe("Hello from assistant!");
  });

  it("should update messages for context changes during streaming", async () => {
    const { deps, sessionManager, contextManager, runtimeEvents } =
      createTestDeps([defaultTextResponse("Streaming text")]);
    const registry = new AgentRegistry();

    const snapshots: DisplayMessage[][] = [];
    const unsubscribe = useTuiState.subscribe((state) => {
      snapshots.push(state.messages);
    });

    const result = connectAgent({
      sessionManager,
      contextManager,
      runtimeEvents,
      uiTimeline: new UITimeline(sessionManager.getContext()),
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    await runAgent(deps, "Hello", new AbortController().signal);
    unsubscribe();

    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    const lastSnapshot = snapshots[snapshots.length - 1];
    const textMsg = lastSnapshot.find((m) => m.role === "text");
    expect(textMsg).toBeDefined();
    expect(textMsg!.content).toBe("Streaming text");
  });

  it("should update token count when agent token count changes", () => {
    const { sessionManager, contextManager, runtimeEvents } = createTestDeps();
    const registry = new AgentRegistry();

    const result = connectAgent({
      sessionManager,
      contextManager,
      runtimeEvents,
      uiTimeline: new UITimeline(sessionManager.getContext()),
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    runtimeEvents.emit({ type: "context.tokens_changed", tokenCount: 5000 });

    const state = useTuiState.getState();
    expect(state.tokenCount).toBe(5000);
  });

  it("should register main agent in registry", () => {
    const { sessionManager, contextManager, runtimeEvents } = createTestDeps();
    const registry = new AgentRegistry();

    const result = connectAgent({
      sessionManager,
      contextManager,
      runtimeEvents,
      uiTimeline: new UITimeline(sessionManager.getContext()),
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    const sessions = registry.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("1");
    expect(sessions[0].type).toBe("main");
    expect(sessions[0].context).toBe(sessionManager.getContext());
  });

  it("should unsubscribe on cleanup", async () => {
    const { deps, sessionManager, contextManager, runtimeEvents } =
      createTestDeps([defaultTextResponse("After cleanup")]);
    const registry = new AgentRegistry();

    const result = connectAgent({
      sessionManager,
      contextManager,
      runtimeEvents,
      uiTimeline: new UITimeline(sessionManager.getContext()),
      initialSession: "test-session",
      registry,
    });

    // Cleanup
    result.cleanup();

    // Reset state to track new changes.
    useTuiState.setState({ messages: [] });

    // Run agent after cleanup
    await runAgent(deps, "After cleanup", new AbortController().signal);

    // Messages should not update after the subscription is removed.
    const state = useTuiState.getState();
    expect(state.messages).toEqual([]);
  });
});

import type { DisplayMessage } from "../display.js";
