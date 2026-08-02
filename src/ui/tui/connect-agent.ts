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
import { SessionPersistence } from "../../services/session-persistence.js";
import type { ContextManager } from "../../services/context-manager.js";
import type { RuntimeEvents } from "../../services/runtime-events.js";
import { useTuiState } from "./state.js";
import { UITimeline } from "./timeline.js";

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
  runtimeEvents: RuntimeEvents;
  uiTimeline: UITimeline;
  initialSession: string;
  sessionName?: string;
  resumeRecent: boolean;
  registry: AgentRegistry;
}

export function connectAgent(options: ConnectAgentOptions): {
  cleanup: () => void;
  prompter: UserPrompter;
} {
  const {
    sessionManager,
    contextManager,
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
    sessionManager.setSession(initialSession);
    useTuiState.setState({ currentSession: initialSession });
    if (sessionName || resumeRecent) {
      const data = await SessionPersistence.load(initialSession);
      if (data) {
        context.replaceBlocks(data.blocks);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          contextManager.setTokenCount(totalTokens);
        }
      } else if (sessionName) {
        sessionManager.reportStatus({
          role: "status",
          content: `Created new session: ${sessionName}`,
          timestamp: new Date(),
        });
      }
    }
  };
  loadInitial();

  // Return cleanup function and prompter for run() calls
  return {
    cleanup: () => {
      unsubRuntimeEvents();
      unsubStore();
    },
    prompter,
  };
}
