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
import { CallbackPrompter } from "../../utils/display.js";
import type { UserPrompter } from "../../utils/display.js";
import type { MessageParam } from "../../messages.js";
import { MessageStore } from "../../messages.js";
import { useTuiStore } from "./store.js";

export interface ConnectAgentOptions {
  agent: Agent;
  initialSession: string;
  sessionName?: string;
  resumeRecent: boolean;
  registry: AgentRegistry;
}

export function connectAgent(options: ConnectAgentOptions): { cleanup: () => void; prompter: UserPrompter } {
  const { agent, initialSession, sessionName, resumeRecent, registry } = options;
  const { dispatch } = useTuiStore.getState();

  // 1. Subscribe to token count signal
  const unsubToken = agent.tokenCount$.subscribe((count) =>
    dispatch({ type: "SET_TOKEN_COUNT", payload: count }),
  );

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

  // 3. Subscribe to MessageStore changes
  const unsubStore = agent.getStore().onChange(() => {
    dispatch({
      type: "SET_MESSAGES",
      payload: agent.getStore().toDisplayMessages(),
    });
  });

  // 4. Register main agent in the registry
  registry.register({ id: "1", type: "main", agent, status: "idle" });
  dispatch({
    type: "SET_AGENT_SESSIONS",
    payload: [{ id: "1", type: "main", agent, status: "idle" }],
  });

  // 5. Load initial session (async — onChange subscription will push updates)
  const loadInitial = async () => {
    agent.setSession(initialSession);
    dispatch({ type: "SET_CURRENT_SESSION", payload: initialSession });
    if (sessionName || resumeRecent) {
      const data = await MessageStore.load(initialSession);
      if (data) {
        agent.setMessages(data.messages as MessageParam[]);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          agent.setTokenCount(totalTokens);
          dispatch({ type: "SET_TOKEN_COUNT", payload: totalTokens });
        }
      } else if (sessionName) {
        agent.getStore().addStatus({
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
      unsubToken();
      unsubStore();
    },
    prompter,
  };
}
