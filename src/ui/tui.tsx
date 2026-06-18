import React, { useCallback, useRef, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { runAgent, isAbortError, type AgentDeps } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { UserPrompter } from "../tools/registry.js";
import { routeInput } from "./routing.js";
import { processRoute } from "./route-handler.js";
import {
  inputRequestToState,
  type CommandContext,
} from "./commands/index.js";
import { AgentRegistry } from "../services/index.js";
import type { RuntimeEvents } from "../services/runtime-events.js";
import type { SessionStats } from "../services/session-stats.js";
import type { SessionManager } from "../services/session-manager.js";
import type { PermissionService } from "../services/permission.js";
import type { ShellService } from "../services/shell-service.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { ContextManager } from "../services/context-manager.js";
import type { LLMContext } from "../llm/context.js";
import { Receipt } from "./tui/Receipt.js";
import { UITimeline } from "./tui/timeline.js";
import { switchSession } from "../services/session-lifecycle.js";
import { SessionPersistence } from "../services/session-persistence.js";
import { createLogger } from "../utils/logger.js";

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
  deps: AgentDeps;
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
  shellService: ShellService;
}

function AppContent({
  deps,
  config,
  version,
  promptFiles,
  initialSession,
  initialPrompt,
  agentRegistry,
  programStartTime,
  sessionStats,
  sessionManager,
  contextManager,
  modelSwitchService,
  context,
  permissionService,
  shellService,
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
  const abortRef = useRef<AbortController | null>(null);

  const [autoSubmitPending, setAutoSubmitPending] =
    React.useState(!!initialPrompt);
  const loadingRef = useRef(false);

  // Sync registry updates (sub-agent progress) into UI state.
  useEffect(() => {
    agentRegistry.setUpdateCallback((sessions) => {
      useTuiState.setState({ agentSessions: sessions });
    });
  }, [agentRegistry]);

  useEffect(() => {
    sessionStats.init(
      programStartTime,
      process.cwd().split("/").pop() || "unknown",
      initialSession,
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cmdContext = useCallback(
    (): CommandContext => ({
      model: deps.model,
      config,
      context,
      sessionManager,
      get changeJournal() {
        return sessionManager.getChangeJournal();
      },
      sessionStats,
      modelSwitchService,
      contextManager,
      isAgentRunning: () => loadingRef.current,
      loadContext: (blocks, totalTokens = 0) => {
        context.replaceBlocks(blocks);
        contextManager.setTokenCount(totalTokens);
      },
      switchSession: async (name, opts) => {
        await switchSession({
          sessionManager,
          sessionName: name,
          setLogger: (logger) => {
            deps.logger = logger;
          },
          setCurrentSession: (session) =>
            useTuiState.setState({ currentSession: session }),
          sessionStats,
          statusMessage: opts?.statusMessage,
        });
      },
      renameCurrentSession: async (newName) => {
        const oldName = sessionManager.getSessionName();
        await SessionPersistence.rename(oldName, newName);
        const newLogger = await createLogger(
          SessionPersistence.getProjectHash(),
          newName,
        );
        sessionManager.setSession(newName);
        deps.logger = newLogger;
        useTuiState.setState({ currentSession: newName });
        sessionManager.reportStatus({
          role: "status",
          content: `Renamed: ${oldName} -> ${newName}`,
          timestamp: new Date(),
        });
      },
      presentInput: (request) => {
        const inputState = inputRequestToState(request);
        useTuiState.setState((state) => ({
          input: {
            ...state.input,
            mode: inputState.mode,
            props: inputState.props,
            value: "",
            key: state.input.key + 1,
          },
        }));
      },
      exit: () => useTuiState.setState({ showReceipt: true }),
    }),
    [deps, sessionManager, contextManager, config, modelSwitchService],
  );

  const handleSubmit = useCallback(
    async (value: string): Promise<boolean> => {
      if (!value.trim()) return false;
      if (loadingRef.current) return false;

      const route = await routeInput(value, cmdContext());
      const processed = processRoute(
        route,
        context,
        shellService,
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
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await runAgent(deps, processed.promptText, ctrl.signal, {
          displayContent: processed.displayContent,
          prompter: prompterRef.current ?? undefined,
        });
        return true;
      } catch (e) {
        if (isAbortError(e)) {
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
        abortRef.current = null;
        // Ensure final messages are always synced to UI state after run.
        uiTimeline.sync();
        useTuiState.setState({ isLoading: false, status: "" });
      }
    },
    [cmdContext, deps, context, sessionManager, uiTimeline, prompterRef],
  );

  useEffect(() => {
    if (autoSubmitPending && initialPrompt) {
      setAutoSubmitPending(false);
      handleSubmit(initialPrompt);
    }
  }, [autoSubmitPending, initialPrompt, handleSubmit]);

  const isModal = pendingPrompt !== null;

  useInput(
    (keyInput, key) => {
      if (key.ctrl && keyInput === "c") {
        if (isLoading) {
          abortRef.current?.abort();
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
        abortRef.current?.abort();
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
          model={deps.model}
          handleSubmit={handleSubmit}
          loadingRef={loadingRef}
          config={config}
          modelSwitchService={modelSwitchService}
        />
      )}
      <SubAgentBar />
      <Panel model={deps.model} promptFiles={promptFiles} />
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
