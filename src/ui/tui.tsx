import React, { useCallback, useRef, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { Agent } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { DisplayMessage } from "./display.js";
import type { UserPrompter } from "../tools/registry.js";
import { routeInput } from "./routing.js";
import { processRoute } from "./route-handler.js";
import { AgentRegistry, type AgentSession } from "../services/index.js";
import type { RuntimeEvents } from "../services/runtime-events.js";
import type { SessionStats } from "../services/session-stats.js";
import type { SessionManager } from "../services/session-manager.js";
import type { PermissionService } from "../services/permission.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { ContextManager } from "../services/context-manager.js";
import type { LLMContext } from "../llm/context.js";
import { Receipt } from "./tui/Receipt.js";
import { UITimeline } from "./tui/timeline.js";

import { useTuiState } from "./tui/state.js";
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
  runtimeEvents: RuntimeEvents;
  programStartTime: number;
  sessionStats: SessionStats;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  modelSwitchService: ModelSwitchService;
  context: LLMContext;
  permissionService: PermissionService;
}

// Hook: multi-agent coordination and switching using Global Store
function useMultiAgent(
  registry: AgentRegistry,
  agentRef: React.MutableRefObject<Agent>,
  uiTimeline: UITimeline,
) {
  const activeAgentId = useTuiState((s) => s.activeAgentId);
  const activeAgentIdRef = useRef(activeAgentId);

  useEffect(() => {
    registry.setUpdateCallback((sessions) => {
      useTuiState.setState({ agentSessions: sessions });
      if (
        activeAgentIdRef.current !== "1" &&
        !sessions.find((s) => s.id === activeAgentIdRef.current)
      ) {
        activeAgentIdRef.current = "1";
        useTuiState.setState({ activeAgentId: "1" });
      }
    });
  }, [registry]);

  const switchToSession = useCallback(
    (session: AgentSession) => {
      activeAgentIdRef.current = session.id;
      useTuiState.setState({ activeAgentId: session.id });
      uiTimeline.setContext(session.context);
      agentRef.current = session.agent;
    },
    [agentRef, uiTimeline],
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
  runtimeEvents,
  programStartTime,
  sessionStats,
  sessionManager,
  contextManager,
  modelSwitchService,
  context,
  permissionService,
  prompterRef,
  uiTimeline,
}: AppProps & {
  prompterRef: React.RefObject<UserPrompter | null>;
  uiTimeline: UITimeline;
}) {
  const { exit } = useApp();
  const input = useTuiState((s) => s.input);
  const pendingPrompt = useTuiState((s) => s.pendingPrompt);
  const isLoading = useTuiState((s) => s.isLoading);
  const showReceipt = useTuiState((s) => s.showReceipt);
  const agentRef = useRef<Agent>(agent);

  const [autoSubmitPending, setAutoSubmitPending] =
    React.useState(!!initialPrompt);
  const loadingRef = useRef(false);

  useMultiAgent(agentRegistry, agentRef, uiTimeline);

  useEffect(() => {
    sessionStats.init(
      programStartTime,
      process.cwd().split("/").pop() || "unknown",
      initialSession,
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cmdContext = useCallback(
    () => ({
      model: agentRef.current.model,
      config,
      context,
      sessionManager,
      get changeJournal() {
        return sessionManager.getChangeJournal();
      },
      sessionStats,
      modelSwitchService,
      contextManager,
      isAgentRunning: () => agentRef.current.isRunning,
      setLogger: (logger: typeof agentRef.current.logger) => {
        agentRef.current.logger = logger;
      },
      setTokenCount: (count: number) => {
        contextManager.setTokenCount(count);
      },
      setMessages: (msgs: DisplayMessage[]) => {
        useTuiState.setState({ messages: msgs });
      },
      setCurrentSession: (session: string) =>
        useTuiState.setState({ currentSession: session }),
      setMode: () => {},
      setInputMode: (mode: string, props?: Record<string, unknown>) =>
        useTuiState.setState((state) => ({
          input: { ...state.input, mode, props: props ?? {} },
        })),
      setSessionList: (sessions: Array<{ name: string }>) =>
        useTuiState.setState((state) => ({
          sessionList: { ...state.sessionList, sessions },
        })),
      setSelectedIndex: (index: number) =>
        useTuiState.setState((state) => ({
          sessionList: { ...state.sessionList, selectedIndex: index },
        })),
      exit: () => useTuiState.setState({ showReceipt: true }),
    }),
    [sessionManager, contextManager, config, modelSwitchService],
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
          uiTimeline.sync();
        }
        return false;
      }

      // "run" — command with prompt or plain LLM input
      loadingRef.current = true;
      useTuiState.setState({ isLoading: true });
      try {
        const sent = await agent.run(processed.promptText, {
          displayContent: processed.displayContent,
          prompter: prompterRef.current ?? undefined,
        });
        if (!sent) {
          useTuiState.setState({ isLoading: false });
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
        // Ensure final messages are always synced to UI state after run.
        uiTimeline.sync();
        useTuiState.setState({ isLoading: false, status: "" });
      }
    },
    [cmdContext],
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
            useTuiState.setState({ pendingPrompt: null });
          }
        } else {
          useTuiState.setState({ showReceipt: true });
        }
        return;
      }
      if (key.shift && key.tab) {
        const next = permissionService.cycleMode();
        useTuiState.setState({ permissionMode: next });
        return;
      }
      if (key.escape && isLoading) {
        agentRef.current?.abort();
        if (pendingPrompt) {
          pendingPrompt.resolve("");
          useTuiState.setState({ pendingPrompt: null });
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
        useTuiState.setState({ pendingPrompt: null });
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
  // Set initial permission mode on UI state.
  useEffect(() => {
    useTuiState.setState({
      permissionMode: props.permissionService.getMode(),
    });
  }, []);

  // Bridge Agent domain observables to UI state.
  const prompterRef = useRef<UserPrompter | null>(null);
  const uiTimelineRef = useRef<UITimeline | null>(null);
  if (!uiTimelineRef.current) {
    uiTimelineRef.current = new UITimeline(props.context);
  }

  useEffect(() => {
    const { cleanup, prompter } = connectAgent({
      agent: props.agent,
      sessionManager: props.sessionManager,
      contextManager: props.contextManager,
      runtimeEvents: props.runtimeEvents,
      uiTimeline: uiTimelineRef.current!,
      initialSession: props.initialSession,
      sessionName: props.sessionName,
      resumeRecent: props.resumeRecent,
      registry: props.agentRegistry,
    });
    prompterRef.current = prompter;
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContent
      {...props}
      prompterRef={prompterRef}
      uiTimeline={uiTimelineRef.current}
    />
  );
}
