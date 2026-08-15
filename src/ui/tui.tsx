import React, { useCallback, useRef, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import type { AgentDeps } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { UserPrompter } from "../tools/registry.js";
import {
  inputRequestToState,
  createCommandContext,
  type CommandContext,
} from "./commands/index.js";
import { processRoutedInput, runAgentTurn } from "./turn.js";
import { AgentRegistry } from "../services/index.js";
import type { RuntimeEvents } from "../services/runtime-events.js";
import type { SessionStats } from "../services/session-stats.js";
import type { SessionManager } from "../services/session-manager.js";
import type { PermissionService } from "../services/permission.js";
import type { ShellService } from "../services/shell-service.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { ContextManager } from "../services/context-manager.js";
import type { RuntimeState } from "../services/runtime-state.js";
import type { LLMContext } from "../llm/context.js";
import type { CommandRegistry } from "./commands/registry.js";
import type { SkillRegistry } from "../skills/index.js";
import type { InputRouter } from "./routing.js";
import { Receipt } from "./tui/Receipt.js";
import { SessionTimeline } from "./timeline.js";

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
  runtimeState: RuntimeState;
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
  commandRegistry: CommandRegistry;
  skillRegistry: SkillRegistry;
  router: InputRouter;
  /** True once session bootstrap + UI wiring completed (safe to auto-run). */
  connected?: boolean;
}

function AppContent({
  deps,
  runtimeState,
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
  commandRegistry,
  skillRegistry,
  router,
  connected = false,
  prompterRef,
  uiTimeline,
}: AppProps & {
  prompterRef: React.RefObject<UserPrompter | null>;
  uiTimeline: SessionTimeline;
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
    (): CommandContext =>
      createCommandContext({
        deps,
        config,
        commands: commandRegistry,
        skills: skillRegistry,
        router,
        sessionStats,
        modelSwitchService,
        contextManager,
        runtimeState,
        bridges: {
          isAgentRunning: () => loadingRef.current,
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
        },
      }),
    [
      deps,
      config,
      commandRegistry,
      skillRegistry,
      sessionStats,
      modelSwitchService,
      contextManager,
      runtimeState,
      router,
    ],
  );

  const handleSubmit = useCallback(
    async (value: string): Promise<boolean> => {
      if (!value.trim()) return false;
      if (loadingRef.current) return false;

      const processed = await processRoutedInput({
        input: value,
        cmdContext: cmdContext(),
        context,
        shellService,
        reportStatus: sessionManager.reportStatus.bind(sessionManager),
        timeline: uiTimeline,
      });

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
        const outcome = await runAgentTurn({
          deps,
          promptText: processed.promptText,
          signal: ctrl.signal,
          prompter: prompterRef.current ?? undefined,
          reportStatus: sessionManager.reportStatus.bind(sessionManager),
        });
        return outcome === "completed";
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
    if (connected && autoSubmitPending && initialPrompt) {
      setAutoSubmitPending(false);
      handleSubmit(initialPrompt);
    }
  }, [connected, autoSubmitPending, initialPrompt, handleSubmit]);

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
        permissionService.cycleMode();
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
        // Cancelling a prompt mid-run means aborting the whole run, not just
        // denying this one request.
        abortRef.current?.abort();
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
          sessionManager={sessionManager}
          commandRegistry={commandRegistry}
          skillRegistry={skillRegistry}
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
  const uiTimelineRef = useRef<SessionTimeline | null>(null);
  if (!uiTimelineRef.current) {
    uiTimelineRef.current = new SessionTimeline(props.context, (messages) =>
      useTuiState.setState({ messages }),
    );
  }
  const [connected, setConnected] = React.useState(false);

  useEffect(() => {
    const { cleanup, prompter } = connectAgent({
      sessionManager: props.sessionManager,
      runtimeEvents: props.runtimeEvents,
      uiTimeline: uiTimelineRef.current!,
      registry: props.agentRegistry,
    });
    prompterRef.current = prompter;
    setConnected(true);
    return cleanup;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContent
      {...props}
      connected={connected}
      prompterRef={prompterRef}
      uiTimeline={uiTimelineRef.current}
    />
  );
}
