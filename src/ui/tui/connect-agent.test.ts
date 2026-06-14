import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Agent } from "../../agent.js";
import { Model } from "../../llm/model.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  createVirtualTool,
} from "../../testing/index.js";
import type { ToolDef } from "../../tools/registry.js";
import { SessionManager } from "../../services/session-manager.js";
import { ContextManager } from "../../services/context-manager.js";
import { PromptManager } from "../../services/prompt-manager.js";
import { ToolExecutor } from "../../tools/executor.js";
import { PermissionService } from "../../services/permission.js";
import { SessionPersistence } from "../../services/session-persistence.js";
import { Signal } from "../../utils/signal.js";
import { AgentRegistry } from "../../services/agent-registry.js";
import { connectAgent } from "./connect-agent.js";
import { useTuiStore, initialState } from "./store.js";

function createTestAgent(responses = [defaultTextResponse("OK")]) {
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
  const tokenCount$ = new Signal(0);
  const sessionManager = new SessionManager();
  const contextManager = new ContextManager({
    contextLength: model.getContextLength(),
    compressionThresholdRatio: 0.8,
    tokenCount$,
    context: sessionManager.getContext(),
  });
  const promptManager = new PromptManager();
  const toolExecutor = new ToolExecutor({
    tools,
    permissionService: new PermissionService("yolo"),
    getChangeJournal: () => sessionManager.getChangeJournal(),
    context: sessionManager.getContext(),
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
  return { agent, sessionManager, tokenCount$ };
}

describe("connectAgent", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Reset Zustand state but keep dispatch function (shallow merge, not replace)
    useTuiStore.setState(initialState);
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-connect-agent-test",
    );
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  it("should dispatch SET_MESSAGES with assistant text after agent.run()", async () => {
    const { agent, sessionManager, tokenCount$ } = createTestAgent([
      defaultTextResponse("Hello from assistant!"),
    ]);
    const registry = new AgentRegistry();

    const result = connectAgent({
      agent,
      sessionManager,
      tokenCount$,
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    // Run the agent
    await agent.run("Hi there");

    // Verify Zustand store received messages
    const state = useTuiStore.getState();

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

  it("should dispatch SET_MESSAGES for each store change during streaming", async () => {
    const { agent, sessionManager, tokenCount$ } = createTestAgent([
      defaultTextResponse("Streaming text"),
    ]);
    const registry = new AgentRegistry();

    const dispatchHistory: DisplayMessage[][] = [];
    const origDispatch = useTuiStore.getState().dispatch;
    // Spy on dispatch to track SET_MESSAGES calls
    useTuiStore.setState({
      dispatch: (action: any) => {
        if (action.type === "SET_MESSAGES") {
          dispatchHistory.push(action.payload);
        }
        origDispatch(action);
      },
    });

    const result = connectAgent({
      agent,
      sessionManager,
      tokenCount$,
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    await agent.run("Hello");

    // Should have dispatched SET_MESSAGES while the context updates.
    expect(dispatchHistory.length).toBeGreaterThanOrEqual(2);

    // Last dispatch should have the final messages
    const lastDispatch = dispatchHistory[dispatchHistory.length - 1];
    const textMsg = lastDispatch.find((m) => m.role === "text");
    expect(textMsg).toBeDefined();
    expect(textMsg!.content).toBe("Streaming text");
  });

  it("should dispatch SET_TOKEN_COUNT when token signal changes", () => {
    const { agent, sessionManager, tokenCount$ } = createTestAgent();
    const registry = new AgentRegistry();

    const result = connectAgent({
      agent,
      sessionManager,
      tokenCount$,
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    // Update token count
    tokenCount$.set(5000);

    const state = useTuiStore.getState();
    expect(state.tokenCount).toBe(5000);
  });

  it("should register main agent in registry", () => {
    const { agent, sessionManager, tokenCount$ } = createTestAgent();
    const registry = new AgentRegistry();

    const result = connectAgent({
      agent,
      sessionManager,
      tokenCount$,
      initialSession: "test-session",
      registry,
    });
    cleanup = result.cleanup;

    const sessions = registry.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("1");
    expect(sessions[0].type).toBe("main");
    expect(sessions[0].agent).toBe(agent);
    expect(sessions[0].context).toBe(sessionManager.getContext());
  });

  it("should unsubscribe on cleanup", async () => {
    const { agent, sessionManager, tokenCount$ } = createTestAgent([
      defaultTextResponse("After cleanup"),
    ]);
    const registry = new AgentRegistry();

    const result = connectAgent({
      agent,
      sessionManager,
      tokenCount$,
      initialSession: "test-session",
      registry,
    });

    // Cleanup
    result.cleanup();

    // Reset store to track new dispatches
    useTuiStore.setState({ messages: [] });

    // Run agent after cleanup
    await agent.run("After cleanup");

    // Messages should NOT be dispatched to Zustand (subscription removed)
    const state = useTuiStore.getState();
    expect(state.messages).toEqual([]);
  });
});

// Import DisplayMessage type for dispatch spy
import type { DisplayMessage } from "../display.js";
