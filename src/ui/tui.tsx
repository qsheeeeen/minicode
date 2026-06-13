import React, { useCallback, useRef, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { Agent } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { DisplayMessage } from "../messages.js";
import type { UserPrompter } from "../tools/registry.js";
import { routeInput } from "./routing.js";
import { processRoute } from "./route-handler.js";
import { AgentRegistry, type AgentSession } from "../services/index.js";
import type { SessionStats } from "../services/session-stats.js";
import type { SessionManager } from "../services/session-manager.js";
import type { PermissionService } from "../services/permission.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { LLMContextManager } from "../context/index.js";
import type { Signal } from "../utils/signal.js";
import { Receipt } from "./tui/Receipt.js";

import { useTuiStore } from "./tui/store.js";
import { connectAgent } from "./tui/connect-agent.js";
import { Header } from "./tui/Header.js";
import { MessageList } from "./tui/MessageList.js";
import { ModalPrompter } from "./tui/ModalPrompter.js";
import { Status } from "./tui/Status.js";
import { InputArea } from "./tui/InputArea.js";
import { SubAgentBar } from "./tui/SubAgentBar.js";
import { Panel } from "./tui/Panel.js";
import { Help } from "./tui/Help.js";

export interface AppProps {
  agent: Agent;
  config: AppConfig;
  version: string;
  promptFiles: string[];
  initialSession: string;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
  agentRegistry: AgentRegistry;
  programStartTime: number;
  sessionStats: SessionStats;
  sessionManager: SessionManager;
  modelSwitchService: ModelSwitchService;
  context: LLMContextManager;
  tokenCount$: Signal<number>;
  permissionService: PermissionService;
}

// Hook: multi-agent coordination and switching using Global Store
function useMultiAgent(
  registry: AgentRegistry,
  agentRef: React.MutableRefObject<Agent>,
) {
  const activeAgentId = useTuiStore((s) => s.activeAgentId);
  const dispatch = useTuiStore((s) => s.dispatch);
  const activeAgentIdRef = useRef(activeAgentId);

  useEffect(() => {
    registry.setUpdateCallback((sessions) => {
      dispatch({ type: "SET_AGENT_SESSIONS", payload: sessions });
      if (
        activeAgentIdRef.current !== "1" &&
        !sessions.find((s) => s.id === activeAgentIdRef.current)
      ) {
        activeAgentIdRef.current = "1";
        dispatch({ type: "SET_ACTIVE_AGENT_ID", payload: "1" });
      }
    });
  }, [registry, dispatch]);

  const switchToSession = useCallback(
    (session: AgentSession) => {
      activeAgentIdRef.current = session.id;
      dispatch({ type: "SET_ACTIVE_AGENT_ID", payload: session.id });
      dispatch({ type: "CLEAR_STATUSES" });
      dispatch({
        type: "SET_MESSAGES",
        payload: session.context.toDisplayMessages([]),
      });
      agentRef.current = session.agent;
    },
    [dispatch, agentRef],
  );

  useInput((input, key) => {
    const sessions = registry.getAll() || [];
    if (sessions.length <= 1) return;

    if (key.ctrl && input === "o") {
      const currentIndex = sessions.findIndex(
        (s) => s.id === activeAgentIdRef.current,
      );
      const nextIndex = (currentIndex + 1) % sessions.length;
      switchToSession(sessions[nextIndex]);
    }

    if (key.upArrow) {
      const currentIndex = sessions.findIndex(
        (s) => s.id === activeAgentIdRef.current,
      );
      const prevIndex = (currentIndex - 1 + sessions.length) % sessions.length;
      switchToSession(sessions[prevIndex]);
    }

    if (key.downArrow) {
      const currentIndex = sessions.findIndex(
        (s) => s.id === activeAgentIdRef.current,
      );
      const nextIndex = (currentIndex + 1) % sessions.length;
      switchToSession(sessions[nextIndex]);
    }
  });

  return { activeAgentIdRef };
}

function AppContent({
  agent,
  config,
  version,
  promptFiles,
  initialSession,
  initialPrompt,
  agentRegistry,
  programStartTime,
  sessionStats,
  sessionManager,
  modelSwitchService,
  context,
  tokenCount$,
  permissionService,
  prompterRef,
}: AppProps & { prompterRef: React.RefObject<UserPrompter | null> }) {
  const { exit } = useApp();
  const dispatch = useTuiStore((s) => s.dispatch);
  const input = useTuiStore((s) => s.input);
  const pendingPrompt = useTuiStore((s) => s.pendingPrompt);
  const isLoading = useTuiStore((s) => s.isLoading);
  const showReceipt = useTuiStore((s) => s.showReceipt);
  const agentRef = useRef<Agent>(agent);

  const [autoSubmitPending, setAutoSubmitPending] =
    React.useState(!!initialPrompt);
  const loadingRef = useRef(false);

  useMultiAgent(agentRegistry, agentRef);

  useEffect(() => {
    sessionStats.init(
      programStartTime,
      process.cwd().split("/").pop() || "unknown",
      initialSession,
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cmdContext = useCallback(
    () => ({
      agent: agentRef.current,
      model: agentRef.current.model,
      config,
      context,
      sessionManager,
      get changeJournal() {
        return sessionManager.getChangeJournal();
      },
      tokenCount$,
      sessionStats,
      modelSwitchService,
      setMessages: (msgs: DisplayMessage[]) => {
        dispatch({ type: "SET_MESSAGES", payload: msgs });
      },
      setCurrentSession: (session: string) =>
        dispatch({ type: "SET_CURRENT_SESSION", payload: session }),
      setMode: () => {},
      setInputMode: (mode: string, props?: Record<string, unknown>) =>
        dispatch({ type: "SET_INPUT_MODE", payload: { mode, props } }),
      setSessionList: (sessions: Array<{ name: string }>) =>
        dispatch({ type: "SET_SESSION_LIST", payload: { sessions } }),
      setSelectedIndex: (index: number) =>
        dispatch({ type: "SET_SELECTED_SESSION_INDEX", payload: index }),
      exit: () => dispatch({ type: "SET_SHOW_RECEIPT", payload: true }),
    }),
    [dispatch, sessionManager, tokenCount$, config, modelSwitchService],
  );

  const handleSubmit = useCallback(
    async (value: string): Promise<boolean> => {
      if (!value.trim() || !agentRef.current) return false;
      if (loadingRef.current) return false;

      const agent = agentRef.current;
      const route = await routeInput(value, cmdContext());
      const processed = processRoute(
        route,
        value,
        context,
        sessionManager.reportStatus.bind(sessionManager),
      );

      if (processed.type === "done") {
        if (processed.shellOutput) {
          const { statuses } = useTuiStore.getState();
          dispatch({
            type: "SET_MESSAGES",
            payload: context.toDisplayMessages(statuses),
          });
        }
        return false;
      }

      // "run" — command with prompt or plain LLM input
      loadingRef.current = true;
      dispatch({ type: "SET_IS_LOADING", payload: true });
      try {
        const sent = await agent.run(processed.promptText, {
          displayContent: processed.displayContent,
          prompter: prompterRef.current ?? undefined,
        });
        if (!sent) {
          dispatch({ type: "SET_IS_LOADING", payload: false });
          return false;
        }
        return true;
      } catch (e) {
        if (e instanceof Error && e.message === "Aborted") {
          sessionManager.reportStatus({
            role: "status",
            content: "(Aborted)",
            timestamp: new Date(),
          });
        } else if (e instanceof Error) {
          sessionManager.reportStatus({
            role: "error",
            content: `(Error: ${e.message})`,
            timestamp: new Date(),
          });
        } else {
          throw e;
        }
        return false;
      } finally {
        loadingRef.current = false;
        // Ensure final messages are always synced to Zustand after run
        const { statuses } = useTuiStore.getState();
        dispatch({
          type: "SET_MESSAGES",
          payload: context.toDisplayMessages(statuses),
        });
        dispatch({ type: "SET_IS_LOADING", payload: false });
        dispatch({ type: "SET_STATUS", payload: "" });
      }
    },
    [dispatch, cmdContext],
  );

  useEffect(() => {
    if (autoSubmitPending && agentRef.current && initialPrompt) {
      setAutoSubmitPending(false);
      handleSubmit(initialPrompt);
    }
  }, [autoSubmitPending, initialPrompt, handleSubmit]);

  const isModal = pendingPrompt !== null;

  useInput(
    (keyInput, key) => {
      if (key.ctrl && keyInput === "c") {
        if (isLoading) {
          agentRef.current?.abort();
          if (pendingPrompt) {
            pendingPrompt.resolve("");
            dispatch({ type: "SET_PENDING_PROMPT", payload: null });
          }
        } else {
          dispatch({ type: "SET_SHOW_RECEIPT", payload: true });
        }
        return;
      }
      if (key.shift && key.tab) {
        const next = permissionService.cycleMode();
        dispatch({ type: "SET_PERMISSION_MODE", payload: next });
        return;
      }
      if (key.escape && isLoading) {
        agentRef.current?.abort();
        if (pendingPrompt) {
          pendingPrompt.resolve("");
          dispatch({ type: "SET_PENDING_PROMPT", payload: null });
        }
        return;
      }
    },
    { isActive: input.mode === "chat" && !isModal },
  );

  useInput(
    (keyInput, key) => {
      if ((key.escape || (key.ctrl && keyInput === "c")) && pendingPrompt) {
        pendingPrompt.resolve("");
        dispatch({ type: "SET_PENDING_PROMPT", payload: null });
      }
    },
    { isActive: isModal },
  );

  return (
    <Box flexDirection="column" height="100%">
      <Header version={version} projectPath={process.cwd()} />
      <MessageList />
      <Status />
      <ModalPrompter />
      {!showReceipt && (
        <InputArea
          agentRef={agentRef}
          handleSubmit={handleSubmit}
          loadingRef={loadingRef}
          config={config}
          modelSwitchService={modelSwitchService}
        />
      )}
      <SubAgentBar />
      <Panel agentRef={agentRef} promptFiles={promptFiles} />
      <Help />
      {showReceipt && (
        <Receipt data={sessionStats.getStats()} onDismiss={() => exit()} />
      )}
    </Box>
  );
}

export function App(props: AppProps) {
  // Set initial permission mode on Zustand store
  useEffect(() => {
    useTuiStore.setState({
      permissionMode: props.permissionService.getMode(),
    });
  }, []);

  // Bridge Agent domain observables to Zustand
  const prompterRef = useRef<UserPrompter | null>(null);
  useEffect(() => {
    const { cleanup, prompter } = connectAgent({
      agent: props.agent,
      sessionManager: props.sessionManager,
      tokenCount$: props.tokenCount$,
      initialSession: props.initialSession,
      sessionName: props.sessionName,
      resumeRecent: props.resumeRecent,
      registry: props.agentRegistry,
    });
    prompterRef.current = prompter;
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <AppContent {...props} prompterRef={prompterRef} />;
}
