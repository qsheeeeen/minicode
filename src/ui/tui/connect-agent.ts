/**
 * connectAgent — bridges Agent domain observables to the Zustand UI store.
 *
 * This function replaces the old `useDisplay` React hook, moving the
 * Agent→UI wiring out of the React tree. TUI components become pure
 * view — they only read from Zustand via selectors.
 *
 * Called once from the App component's useEffect. Returns a cleanup
 * function for unsubscription.
 */
import type { Agent } from "../../agent.js";
import type { AgentRegistry } from "../../services/index.js";
import type { SessionManager } from "../../services/session-manager.js";
import type { UserPrompter, Prompt } from "../../tools/registry.js";
import { toDisplayMessages } from "../display.js";
import { SessionPersistence } from "../../services/session-persistence.js";
import type { ContextManager } from "../../services/context-manager.js";
import { useTuiStore } from "./store.js";

/** UserPrompter implementation: resolves/rejects via Zustand store state. */
class CallbackPrompter implements UserPrompter {
  constructor(private onPrompt: (req: Prompt) => Promise<string>) {}
  prompt(req: Prompt): Promise<string> {
    return this.onPrompt(req);
  }
}

export interface ConnectAgentOptions {
  agent: Agent;
  sessionManager: SessionManager;
  contextManager: ContextManager;
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
    agent,
    sessionManager,
    contextManager,
    initialSession,
    sessionName,
    resumeRecent,
    registry,
  } = options;
  const context = sessionManager.getContext();
  const { dispatch } = useTuiStore.getState();

  // Helper: sync display messages from LLMContext + Zustand statuses
  const syncMessages = () => {
    const { statuses } = useTuiStore.getState();
    dispatch({
      type: "SET_MESSAGES",
      payload: toDisplayMessages(context.getBlocks(), statuses),
    });
  };

  // 1. Sync token count updates from the agent into Zustand.
  agent.onTokenCountChange = (count) => {
    dispatch({ type: "SET_TOKEN_COUNT", payload: count });
  };

  // 2. Create CallbackPrompter — resolves/rejects via store state
  const prompter = new CallbackPrompter(
    (req) =>
      new Promise<string>((resolve) => {
        dispatch({
          type: "SET_PENDING_PROMPT",
          payload: { ...req, resolve },
        });
      }),
  );

  // 3. Wire StatusReporter: statuses → Zustand + re-sync display messages
  sessionManager.setStatusReporter((msg) => {
    const userMessageIndex = context.getUserMessageCount();
    dispatch({ type: "ADD_STATUS", payload: { ...msg, userMessageIndex } });
    syncMessages();
  });

  // 4. Subscribe to LLMContext changes → re-sync display messages
  const unsubStore = context.onChange(syncMessages);

  // 5. Register main agent in the registry
  registry.register({ id: "1", type: "main", agent, context, status: "idle" });
  dispatch({
    type: "SET_AGENT_SESSIONS",
    payload: [{ id: "1", type: "main", agent, context, status: "idle" }],
  });

  // 6. Load initial session (async — onChange subscription will push updates)
  const loadInitial = async () => {
    sessionManager.setSession(initialSession);
    dispatch({ type: "SET_CURRENT_SESSION", payload: initialSession });
    if (sessionName || resumeRecent) {
      const data = await SessionPersistence.load(initialSession);
      if (data) {
        context.replaceBlocks(data.blocks);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          contextManager.setTokenCount(totalTokens);
          dispatch({ type: "SET_TOKEN_COUNT", payload: totalTokens });
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
      agent.onTokenCountChange = undefined;
      unsubStore();
    },
    prompter,
  };
}
