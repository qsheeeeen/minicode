/**
 * connectAgent — bridges Agent domain observables to UI state.
 *
 * This function replaces the old `useDisplay` React hook, moving the
 * Agent→UI wiring out of the React tree. TUI components become pure
 * view — they only read UI state via selectors.
 *
 * Called once from the App component's useEffect. Returns a cleanup
 * function for unsubscription.
 */
import type { AgentRegistry } from "../../services/index.js";
import type { SessionManager } from "../../services/session-manager.js";
import type { UserPrompter, Prompt } from "../../tools/registry.js";
import type { ContextManager } from "../../services/context-manager.js";
import type { RuntimeState } from "../../services/runtime-state.js";
import type { RuntimeEvents } from "../../services/runtime-events.js";
import { restoreSession } from "../../services/session-lifecycle.js";
import { useTuiState } from "./state.js";
import type { SessionTimeline } from "../timeline.js";

/** UserPrompter implementation: resolves/rejects via UI state. */
class CallbackPrompter implements UserPrompter {
  constructor(private onPrompt: (req: Prompt) => Promise<string>) {}
  prompt(req: Prompt): Promise<string> {
    return this.onPrompt(req);
  }
}

export interface ConnectAgentOptions {
  sessionManager: SessionManager;
  contextManager: ContextManager;
  runtimeState: RuntimeState;
  runtimeEvents: RuntimeEvents;
  uiTimeline: SessionTimeline;
  initialSession: string;
  sessionName?: string;
  resumeRecent: boolean;
  registry: AgentRegistry;
}

export function connectAgent(options: ConnectAgentOptions): {
  cleanup: () => void;
  prompter: UserPrompter;
  /** Resolves once the initial session has been activated/restored. */
  ready: Promise<void>;
} {
  const {
    sessionManager,
    contextManager,
    runtimeState,
    runtimeEvents,
    uiTimeline,
    initialSession,
    sessionName,
    resumeRecent,
    registry,
  } = options;
  const context = sessionManager.getContext();

  // 1. Sync runtime token events into UI state.
  const unsubRuntimeEvents = runtimeEvents.subscribe((event) => {
    if (event.type === "context.tokens_changed") {
      useTuiState.setState({ tokenCount: event.tokenCount });
      return;
    }

    if (event.type === "status.added") {
      uiTimeline.appendStatus(event.status);
      return;
    }

    if (event.type === "session.changed") {
      useTuiState.setState({ currentSession: event.sessionName });
      return;
    }

    if (event.type === "permission.mode_changed") {
      useTuiState.setState({ permissionMode: event.mode });
    }
  });

  // 2. Create CallbackPrompter — resolves/rejects via UI state
  const prompter = new CallbackPrompter(
    (req) =>
      new Promise<string>((resolve) => {
        useTuiState.setState({ pendingPrompt: { ...req, resolve } });
      }),
  );

  // 3. Subscribe to LLMContext changes → re-sync display messages
  const unsubStore = context.onChange(() => uiTimeline.sync());

  // 4. Register main agent in the registry
  registry.register({ id: "1", type: "main", context, status: "idle" });
  useTuiState.setState({
    agentSessions: [{ id: "1", type: "main", context, status: "idle" }],
  });

  // 5. Load initial session (async — onChange subscription will push updates)
  const loadInitial = async () => {
    try {
      const { loaded } = await restoreSession({
        sessionManager,
        contextManager,
        runtimeState,
        name: initialSession,
        load: !!(sessionName || resumeRecent),
      });
      if (sessionName && !loaded) {
        sessionManager.reportStatus({
          role: "status",
          content: `Created new session: ${sessionName}`,
          timestamp: new Date(),
        });
      }
    } catch (e) {
      sessionManager.reportStatus({
        role: "error",
        content: `Session restore failed: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  };
  const ready = loadInitial();

  // Return cleanup function and prompter for run() calls
  return {
    cleanup: () => {
      unsubRuntimeEvents();
      unsubStore();
    },
    prompter,
    ready,
  };
}
