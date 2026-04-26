import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner, ProgressBar } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import { Agent } from '../agent.js';
import type { MessageParam } from '../llm/anthropic.js';
import type { ResolvedConfig } from '../config.js';
import { CallbackDisplay, type DisplayMessage, type ConfirmationRequest } from '../utils/display.js';
import { SessionDisplayImpl } from '../utils/session-display.js';
import { commandRegistry, type CommandContext } from './commands/index.js';
import './commands/builtin.js';
import { Message } from '../components/Message.js';
import type { SessionManager } from '../utils/session.js';
import { AgentRegistry, type AgentSession } from '../services/agent-registry.js';
import type { PermissionMode } from '../services/permission.js';

export interface AppProps {
  agent: Agent;
  config: ResolvedConfig;
  version: string;
  promptFiles: string[];
  initialSession: string;
  sessionManager: SessionManager;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
}


/** Hook: multi-agent coordination and switching */
function useMultiAgent() {
  const [activeAgentId, setActiveAgentId] = useState<string>('1');
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const registryRef = useRef<AgentRegistry | null>(null);
  const activeAgentIdRef = useRef('1');

  useEffect(() => {
    const registry = new AgentRegistry();
    registryRef.current = registry;
    registry.setUpdateCallback((sessions) => {
      setAgentSessions(sessions);
      // Auto-switch to main if current agent was removed
      if (activeAgentIdRef.current !== '1' && !sessions.find(s => s.id === activeAgentIdRef.current)) {
        activeAgentIdRef.current = '1';
        setActiveAgentId('1');
      }
    });
  }, []);

  return { activeAgentId, activeAgentIdRef, setActiveAgentId, agentSessions, setAgentSessions, registryRef };
}

/** Hook: attach display to agent, load initial session */
function useDisplay(
  agent: Agent,
  initialSession: string,
  sessionManager: SessionManager,
  sessionName: string | undefined,
  resumeRecent: boolean,
  setAgentSessions: React.Dispatch<React.SetStateAction<AgentSession[]>>,
  registryRef: React.MutableRefObject<AgentRegistry | null>,
  setApprovalRequest: (req: (ConfirmationRequest & { resolve: (v: boolean) => void }) | null) => void,
) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [tokenCount, setTokenCount] = useState(0);

  useEffect(() => {
    const registry = registryRef.current;
    if (!registry) return;

    // Confirm resolver ref — used by key handlers to resolve pending confirms
    const confirmResolvers: Array<(v: boolean) => void> = [];

    // Set up TUI display adapter with confirm via React state
    agent.setDisplay(new CallbackDisplay({
      onTokenUpdate: setTokenCount,
      onConfirm: (req: ConfirmationRequest) => new Promise<boolean>((resolve) => {
        confirmResolvers.push(resolve);
        setApprovalRequest({ ...req, resolve });
      }),
    }));

    // Expose resolvers so key handlers can resolve them
    (agent as any).__confirmResolvers = confirmResolvers;

    // Subscribe to store changes for display updates
    agent.getStore().onChange(() => {
      setMessages(agent.getStore().toDisplayMessages());
    });

    registry.register({
      id: '1',
      type: 'main',
      agent,
      status: 'idle',
    });

    setAgentSessions([{
      id: '1',
      type: 'main',
      agent,
      status: 'idle',
    }]);

    // Load initial session
    const loadInitial = async () => {
      agent.currentSession = initialSession;
      if (sessionName || resumeRecent) {
        const data = await sessionManager.get(initialSession);
        if (data) {
          agent.setMessages(data.messages as MessageParam[]);
          const totalTokens = data.totalTokens || 0;
          if (totalTokens > 0) {
            agent.setTokenCount(totalTokens);
          }
          const sessionDisplay = new SessionDisplayImpl(sessionManager, agent.getToolRegistry());
          const displayMessages = await sessionDisplay.loadForTUI(initialSession);
          if (displayMessages.length > 0) {
            setMessages(displayMessages);
          }
        } else if (sessionName) {
          const sysMsg = { role: 'status' as const, content: `Created new session: ${sessionName}`, timestamp: new Date() };
          setMessages([sysMsg]);
        }
      }
    };
    loadInitial();

    return () => { (agent as any).__confirmResolvers = []; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, setMessages, currentSession, setCurrentSession, tokenCount };
}

export function App({
  agent,
  config,
  version,
  promptFiles,
  initialSession,
  sessionManager,
  initialPrompt,
  sessionName,
  resumeRecent,
}: AppProps) {
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'chat' | 'session-list'>('chat');
  const [sessionListState, setSessionListState] = useState<{
    sessions: Array<{ name: string }>;
    selectedIndex: number;
  }>({ sessions: [], selectedIndex: 0 });
  const [inputValue, setInputValue] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [autoSubmitPending, setAutoSubmitPending] = useState(!!initialPrompt);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(agent.getPermissionService()?.getMode() ?? 'manual');
  const [approvalRequest, setApprovalRequest] = useState<(ConfirmationRequest & { resolve: (v: boolean) => void }) | null>(null);
  const agentRef = useRef<Agent>(agent);
  const { exit } = useApp();

  // Multi-agent hook
  const { activeAgentId, activeAgentIdRef, setActiveAgentId, agentSessions, setAgentSessions, registryRef } = useMultiAgent();

  // Display hook: attach TUI display to agent, load initial session
  const { messages, setMessages, currentSession, setCurrentSession, tokenCount } = useDisplay(
    agent, initialSession, sessionManager, sessionName, resumeRecent,
    setAgentSessions, registryRef,
    setApprovalRequest,
  );

  const setSessionList = (sessions: Array<{ name: string }>) => {
    setSessionListState(prev => ({ ...prev, sessions }));
  };

  const setSelectedIndex = (index: number) => {
    setSessionListState(prev => ({ ...prev, selectedIndex: index }));
  };

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || !agentRef.current) return;

    const commandContext: CommandContext = {
      agent: agentRef.current,
      sessionManager,
      setMessages,
      setCurrentSession,
      setMode,
      setSessionList,
      setSelectedIndex,
      exit,
    };

    const result = await commandRegistry.parseAndExecute(value, commandContext);
    if (result.handled && !result.promptText) return;

    const userText = result.displayContent ?? result.promptText ?? value;
    setMessages(prev => [...prev, { role: 'user', content: userText, timestamp: new Date() }]);
    setIsLoading(true);
    try {
      await agentRef.current.run(userText);
    } catch (e) {
      if (e instanceof Error && e.message === 'Aborted') {
        setMessages(prev => [...prev, { role: 'status' as const, content: '(Aborted)', timestamp: new Date() }]);
      } else if (e instanceof Error) {
        setMessages(prev => [...prev, { role: 'error' as const, content: `(Error: ${e.message})`, timestamp: new Date() }]);
      } else {
        throw e;
      }
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  }, [exit]);

  useEffect(() => {
    if (autoSubmitPending && agentRef.current && initialPrompt) {
      setAutoSubmitPending(false);
      handleSubmit(initialPrompt);
    }
  }, [autoSubmitPending, initialPrompt, handleSubmit]);

  // Session list overlay
  if (mode === 'session-list') {
    useInput((_input, key) => {
      if (key.return && sessionListState.sessions.length > 0) {
        const name = sessionListState.sessions[sessionListState.selectedIndex]?.name;
        if (name) {
          handleSubmit(`/resume ${name}`);
        }
        setMode('chat');
      } else if (key.escape) {
        setMode('chat');
      } else if (key.upArrow) {
        setSessionListState(prev => {
          const maxIndex = Math.max(0, prev.sessions.length - 1);
          const newIndex = Math.max(0, prev.selectedIndex - 1);
          return { ...prev, selectedIndex: Math.min(newIndex, maxIndex) };
        });
      } else if (key.downArrow) {
        setSessionListState(prev => {
          const maxIndex = Math.max(0, prev.sessions.length - 1);
          const newIndex = prev.selectedIndex + 1;
          return { ...prev, selectedIndex: Math.min(newIndex, maxIndex) };
        });
      }
    });

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="double" borderColor="blue">
        <Text bold color="blue" underline>Sessions</Text>
        <Text dimColor> ↑↓ navigate, Enter select, Esc cancel</Text>
        {sessionListState.sessions.map((s, i) => (
          <Text key={s.name} color={i === sessionListState.selectedIndex ? 'blue' : 'white'} bold={i === sessionListState.selectedIndex}>
            {i === sessionListState.selectedIndex ? '> ' : '  '}{s.name}
          </Text>
        ))}
      </Box>
    );
  }

  // Approval prompt input handler — resolves pending confirm promise
  useInput((_input, key) => {
    if (!approvalRequest) return;
    if (_input === 'y' || key.return) {
      approvalRequest.resolve(true);
      setApprovalRequest(null);
    } else if (_input === 'n' || key.escape) {
      approvalRequest.resolve(false);
      setApprovalRequest(null);
    } else if (_input === 'a') {
      approvalRequest.resolve(true);
      setApprovalRequest(null);
      agent.getPermissionService()?.setMode('yolo');
      setPermissionMode('yolo');
    }
  }, { isActive: approvalRequest !== null });

  // Main input handler
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isLoading) {
        agentRef.current?.abort();
        if (approvalRequest) {
          approvalRequest.resolve(false);
          setApprovalRequest(null);
        }
      } else {
        exit();
      }
      return;
    }
    if (key.shift && key.tab) {
      const next = agent.getPermissionService()?.cycleMode() ?? 'manual';
      setPermissionMode(next);
      return;
    }
    if (key.escape && isLoading) {
      agentRef.current?.abort();
      if (approvalRequest) {
        approvalRequest.resolve(false);
        setApprovalRequest(null);
      }
      return;
    }
    if (key.ctrl && input === 'o') {
      const sessions = registryRef.current?.getAll() || [];
      if (sessions.length <= 1) return;
      const currentIndex = sessions.findIndex(s => s.id === activeAgentIdRef.current);
      const nextIndex = (currentIndex + 1) % sessions.length;
      const nextSession = sessions[nextIndex];
      activeAgentIdRef.current = nextSession.id;
      setActiveAgentId(nextSession.id);
      setMessages(nextSession.agent.getStore().toDisplayMessages());
    }
  }, { isActive: mode === 'chat' && approvalRequest === null });

  // Command autocomplete
  const commandList = useMemo(
    () => commandRegistry.getCommandList().sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const matchingCommands = useMemo(() => {
    if (!inputValue.startsWith('/')) return [];
    const partial = inputValue.slice(1).toLowerCase();
    if (partial === '') return commandList;
    return commandList.filter(cmd => cmd.name.toLowerCase().startsWith(partial));
  }, [inputValue, commandList]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // Reset selection when matches change
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [matchingCommands.length]);

  useInput((_input, key) => {
    if (mode !== 'chat' || approvalRequest !== null || matchingCommands.length === 0) return;
    if (key.upArrow) {
      setSelectedSuggestion(prev => (prev - 1 + matchingCommands.length) % matchingCommands.length);
    } else if (key.downArrow) {
      setSelectedSuggestion(prev => (prev + 1) % matchingCommands.length);
    } else if (key.tab) {
      setInputValue(`/${matchingCommands[selectedSuggestion].name} `);
      setInputKey(prev => prev + 1);
    }
  }, { isActive: mode === 'chat' && approvalRequest === null && matchingCommands.length > 0 });

  // Permission mode display helpers
  const modeLabel = permissionMode;
  const modeColor = permissionMode === 'manual' ? 'yellow' : permissionMode === 'yolo' ? 'red' : 'cyan';

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Box flexGrow={1}>
          <Text bold color="cyan">Mini Code</Text>
          <Text dimColor> v</Text>
          <Text dimColor>{version}</Text>
          <Text dimColor> | </Text>
          <Text color="green">{config.model!.provider}</Text>
          <Text dimColor>:</Text>
          <Text>{config.model!.model}</Text>
          {promptFiles.length > 0 && (
            <>
              <Text dimColor> | </Text>
              <Text dimColor>{promptFiles.join(', ')}</Text>
            </>
          )}
        </Box>
        <Box>
          {agentSessions.length > 1 && (
            <>
              <Text bold color="cyan">[{activeAgentId === '1' ? 'M' : activeAgentId}]</Text>
              <Text dimColor> | </Text>
            </>
          )}
          <Text dimColor>{currentSession}</Text>
          {status && !isLoading && <Text dimColor> | </Text>}
          {status && !isLoading && <Text color="magenta">{status}</Text>}
        </Box>
      </Box>

      {/* Messages */}
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {messages.length === 0 ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Text dimColor>Type a message to start...</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {messages.map((msg, i) => (
              <Message key={i} role={msg.role} content={msg.content} isStreaming={msg.isStreaming} element={msg.element} />
            ))}
          </Box>
        )}
        {agentSessions.length > 1 && (
          <Box marginTop={1}>
            <Text dimColor color="yellow">Ctrl+O: switch agent</Text>
          </Box>
        )}
      </Box>

      {/* Approval prompt */}
      {approvalRequest && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Box flexDirection="column">
            <Text bold color="yellow">{approvalRequest.title}</Text>
            <Text>{approvalRequest.message}</Text>
            <Text dimColor>[y] Yes  [n] No  [a] Yes to all</Text>
          </Box>
        </Box>
      )}

      {/* Input */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box width={3}>
          {isLoading ? (
            <Spinner label="" />
          ) : approvalRequest ? (
            <Text color="yellow" bold>!</Text>
          ) : (
            <Text color="blue" bold>{'>'}</Text>
          )}
        </Box>
        {approvalRequest ? (
          <Text dimColor>Waiting for approval...</Text>
        ) : (
          <TextInput
            key={inputKey}
            value={inputValue}
            onChange={setInputValue}
            onSubmit={async (value) => {
              setInputValue('');
              await handleSubmit(value);
            }}
            placeholder="Type a message or /command..."
          />
        )}
      </Box>

      {/* Command autocomplete suggestions */}
      {matchingCommands.length > 0 && !approvalRequest && !isLoading && (
        <Box flexDirection="column" paddingX={2} borderStyle="single" borderColor="gray">
          {matchingCommands.map((cmd, i) => (
            <Box key={cmd.name} flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text>{i === selectedSuggestion ? <Text color="cyan">{'>'}</Text> : ' '}</Text>
              </Box>
              <Box width={20} flexShrink={0}>
                <Text color={i === selectedSuggestion ? 'cyan' : 'white'} bold={i === selectedSuggestion}>
                  /{cmd.name}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="truncate">{cmd.description.split('\n')[0].trim()}</Text>
              </Box>
            </Box>
          ))}
          <Text dimColor> ↑↓ navigate  Tab accept</Text>
        </Box>
      )}

      {/* Status bar: tokens + context progress + permission mode */}
      <Box paddingX={1} gap={1}>
        <Text dimColor>{tokenCount.toLocaleString()}/{(config.model?.contextLength || 200000).toLocaleString()}</Text>
        <Box width={20}><ProgressBar value={Math.min(100, tokenCount / (config.model?.contextLength || 200000) * 100)} /></Box>
        <Text dimColor>{Math.min(100, Math.floor(tokenCount / (config.model?.contextLength || 200000) * 100))}%</Text>
        <Text dimColor> │ </Text>
        <Text color={modeColor}>{modeLabel}</Text>
        <Text dimColor> (Shift+Tab)</Text>
        {isLoading && <Text dimColor> │ </Text>}
        {isLoading && <Text color="magenta">esc to abort</Text>}
      </Box>
    </Box>
  );
}
