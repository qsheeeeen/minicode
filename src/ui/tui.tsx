import React, { useCallback, useRef, useEffect } from "react";
import { Box, useInput, useApp } from "ink";
import { Agent } from "#src/agent.js";
import type { MessageParam } from "#src/llm/anthropic.js";
import type { ResolvedConfig } from "#src/config.js";
import { CallbackEvents, CallbackPrompter } from "#src/utils/display.js";
import { executeCommand } from "./commands/index.js";
import { MessageStore } from "#src/messages.js";
import { AgentRegistry, type AgentSession } from "#src/services/index.js";

import { TuiProvider, useTuiState, useTuiDispatch } from "./tui/store.js";
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
  config: ResolvedConfig;
  version: string;
  promptFiles: string[];
  initialSession: string;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
  agentRegistry: AgentRegistry;
}

/** Hook: multi-agent coordination and switching using Global Store */
function useMultiAgent(
  registry: AgentRegistry,
  agentRef: React.MutableRefObject<Agent>,
) {
  const { activeAgentId } = useTuiState();
  const dispatch = useTuiDispatch();
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
      dispatch({
        type: "SET_MESSAGES",
        payload: session.agent.getStore().toDisplayMessages(),
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
      const prevIndex =
        (currentIndex - 1 + sessions.length) % sessions.length;
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

/** Hook: attach display to agent, load initial session using Global Store */
function useDisplay(
  agent: Agent,
  initialSession: string,
  sessionName: string | undefined,
  resumeRecent: boolean,
  registry: AgentRegistry,
) {
  const dispatch = useTuiDispatch();

  useEffect(() => {
    agent.setEvents(
      new CallbackEvents({
        onStatus: (msg) => dispatch({ type: "ADD_MESSAGE", payload: msg }),
        onTokenUpdate: (count) =>
          dispatch({ type: "SET_TOKEN_COUNT", payload: count }),
      }),
    );

    agent.setPrompter(
      new CallbackPrompter(
        (req) =>
          new Promise<string>((resolve) => {
            dispatch({
              type: "SET_PENDING_PROMPT",
              payload: { ...req, resolve },
            });
          }),
      ),
    );

    agent.getStore().onChange(() => {
      dispatch({
        type: "SET_MESSAGES",
        payload: agent.getStore().toDisplayMessages(),
      });
    });

    registry.register({
      id: "1",
      type: "main",
      agent,
      status: "idle",
    });

    dispatch({
      type: "SET_AGENT_SESSIONS",
      payload: [
        {
          id: "1",
          type: "main",
          agent,
          status: "idle",
        },
      ],
    });

    const loadInitial = async () => {
      agent.currentSession = initialSession;
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
          agent
            .getStore()
            .addStatus({
              role: "status",
              content: `Created new session: ${sessionName}`,
              timestamp: new Date(),
            });
        }
      }
    };
    loadInitial();

    return () => {};
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function AppContent({
  agent,
  version,
  promptFiles,
  initialSession,
  initialPrompt,
  sessionName,
  resumeRecent,
  agentRegistry,
}: Omit<AppProps, "config">) {
  const { exit } = useApp();
  const dispatch = useTuiDispatch();
  const { input, pendingPrompt, isLoading } = useTuiState();
  const agentRef = useRef<Agent>(agent);

  const [autoSubmitPending, setAutoSubmitPending] =
    React.useState(!!initialPrompt);
  const loadingRef = useRef(false);

  useMultiAgent(agentRegistry, agentRef);
  useDisplay(agent, initialSession, sessionName, resumeRecent, agentRegistry);

  const cmdContext = useCallback(() => ({
    agent: agentRef.current,
    setMessages: (msgs: any) => {
      if (typeof msgs !== "function") {
        dispatch({ type: "SET_MESSAGES", payload: msgs });
      }
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
    exit,
  }), [dispatch, exit]);

  const handleSubmit = useCallback(
    async (value: string): Promise<boolean> => {
      const trimmed = value.trim();
      if (!trimmed || !agentRef.current) return false;
      if (loadingRef.current) return false;

      const agent = agentRef.current;

      // ! prefix → direct bash execution
      if (trimmed.startsWith("!")) {
        const cmd = trimmed.slice(1).trim();
        if (!cmd) return false;
        const { execSync } = await import("child_process");
        let text: string;
        try {
          const output = execSync(cmd, { encoding: "utf-8", timeout: 30000, cwd: process.cwd() });
          text = output.trim() || "(no output)";
        } catch (e: any) {
          text = `Error: ${e.message}`;
        }
        agent.getStore().addUserMessage(`Ran: ${cmd}\n\n\`\`\`\n${text}\n\`\`\``, trimmed);
        agent.getStore().addStatus({
          role: "status",
          content: `$ ${cmd}\n${text}`,
          toolDisplay: { name: "Bash", input: { command: cmd }, output: text },
          timestamp: new Date(),
        });
        dispatch({ type: "SET_MESSAGES", payload: agent.getStore().toDisplayMessages() });
        return false;
      }

      // / prefix → command resolution
      if (trimmed.startsWith("/")) {
        const parts = trimmed.slice(1).split(/\s+/);
        const name = parts[0];
        const args = parts.slice(1);
        const result = await executeCommand(name, args, cmdContext());
        if (result.handled) {
          if (result.promptText) {
            dispatch({ type: "SET_IS_LOADING", payload: true });
            loadingRef.current = true;
            try {
              await agent.run(result.promptText, { displayContent: result.displayContent });
            } catch (e) {
              if (e instanceof Error) {
                agent.getStore().addStatus({ role: "error", content: `(Error: ${e.message})`, timestamp: new Date() });
              } else throw e;
            } finally {
              loadingRef.current = false;
              dispatch({ type: "SET_IS_LOADING", payload: false });
              dispatch({ type: "SET_STATUS", payload: "" });
            }
          }
          dispatch({ type: "SET_MESSAGES", payload: agent.getStore().toDisplayMessages() });
        }
        return false;
      }

      // Plain text → LLM
      loadingRef.current = true;
      dispatch({ type: "SET_IS_LOADING", payload: true });
      try {
        const sent = await agent.run(trimmed);
        if (!sent) {
          dispatch({ type: "SET_IS_LOADING", payload: false });
          return false;
        }
        return true;
      } catch (e) {
        if (e instanceof Error && e.message === "Aborted") {
          agent.getStore().addStatus({ role: "status", content: "(Aborted)", timestamp: new Date() });
        } else if (e instanceof Error) {
          agent.getStore().addStatus({ role: "error", content: `(Error: ${e.message})`, timestamp: new Date() });
        } else {
          throw e;
        }
        return false;
      } finally {
        loadingRef.current = false;
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
          exit();
        }
        return;
      }
      if (key.shift && key.tab) {
        const next =
          agentRef.current.getPermissionService()?.cycleMode() ?? "manual";
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
      <Header version={version} promptFiles={promptFiles} agentRef={agentRef} />
      <MessageList />
      <ModalPrompter />
      <Status />
      <InputArea
        agentRef={agentRef}
        handleSubmit={handleSubmit}
        loadingRef={loadingRef}
      />
      <SubAgentBar />
      <Panel agentRef={agentRef} />
      <Help />
    </Box>
  );
}

export function App(props: AppProps) {
  return (
    <TuiProvider
      initialState={{
        permissionMode:
          props.agent.getPermissionService()?.getMode() ?? "manual",
      }}
    >
      <AppContent {...props} />
    </TuiProvider>
  );
}
