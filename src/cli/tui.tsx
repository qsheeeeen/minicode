import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner, ProgressBar } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import { Agent } from '../agent.js';
import type { MessageParam } from '../llm/anthropic.js';
import { AnthropicClient } from '../llm/anthropic.js';
import type { ResolvedConfig } from '../config.js';
import { CallbackDisplay, type DisplayMessage } from '../utils/display.js';
import { SessionDisplayImpl } from '../utils/session-display.js';
import { commandRegistry, type CommandContext } from './commands/index.js';
import './commands/builtin.js';
import { Message } from '../components/Message.js';
import type { SessionManager } from '../utils/session.js';
import { AgentRegistry, type AgentSession } from '../services/agent-registry.js';
import { PermissionService, type PermissionMode, type PermissionGate, type PermissionRequest } from '../services/permission.js';

export interface AppProps {
  config: ResolvedConfig;
  version: string;
  userPrompt: string;
  promptFiles: string[];
  initialSession: string;
  sessionManager: SessionManager;
  initialPrompt?: string;
  sessionName?: string;
  resumeRecent: boolean;
  permissionMode: PermissionMode;
}


/** TUI-based permission gate: shows approval prompt, resolves on keypress */
class TUIPermissionGate implements PermissionGate {
  private pendingResolve: ((decision: boolean) => void) | null = null;
  private _setApprovalRequest: React.Dispatch<React.SetStateAction<PermissionRequest | null>>;
  private onSwitchToYolo: (() => void) | null = null;

  constructor(
    setApprovalRequest: React.Dispatch<React.SetStateAction<PermissionRequest | null>>,
    onSwitchToYolo?: (() => void) | null,
  ) {
    this._setApprovalRequest = setApprovalRequest;
    this.onSwitchToYolo = onSwitchToYolo ?? null;
  }

  async requestApproval(req: PermissionRequest): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this._setApprovalRequest(req);
    });
  }

  resolve(decision: boolean): void {
    this._setApprovalRequest(null);
    this.pendingResolve?.(decision);
    this.pendingResolve = null;
  }

  resolveApproveAll(): void {
    this._setApprovalRequest(null);
    this.pendingResolve?.(true);
    this.pendingResolve = null;
    this.onSwitchToYolo?.();
  }
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

/** Hook: agent initialization, session loading, message submission */
function useAgent(
  config: ResolvedConfig,
  userPrompt: string,
  initialSession: string,
  sessionManager: SessionManager,
  sessionName: string | undefined,
  resumeRecent: boolean,
  setAgentSessions: React.Dispatch<React.SetStateAction<AgentSession[]>>,
  registryRef: React.MutableRefObject<AgentRegistry | null>,
  permissionService: PermissionService | undefined,
) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [tokenCount, setTokenCount] = useState(0);
  const agentRef = useRef<Agent | null>(null);

  // Initialize agent once
  useEffect(() => {
    const registry = registryRef.current;
    if (!registry) return;

    const displayAdapter = new CallbackDisplay({
      onTokenUpdate: setTokenCount
    });

    const agent = new Agent({
      apiKey: config.model!.apiKey,
      baseURL: config.model!.baseURL,
      model: config.model!.model,
      contextLength: config.model!.contextLength,
      compressionThresholdRatio: config.compressionThreshold,
      thinkingEnabled: config.thinking.enabled,
      thinkingTokens: config.thinking.tokens,
      display: displayAdapter,
      userPrompt,
      agentRegistry: registry,
      currentAgentId: '1',
      permissionService,
    });

    agentRef.current = agent;

    // Subscribe to store changes for tool/status/error messages
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

    return () => { agentRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, setMessages, currentSession, setCurrentSession, tokenCount, agentRef };
}

export function App({
  config,
  version,
  userPrompt,
  promptFiles,
  initialSession,
  sessionManager,
  initialPrompt,
  sessionName,
  resumeRecent,
  permissionMode: initialPermissionMode,
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
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(initialPermissionMode);
  const [approvalRequest, setApprovalRequest] = useState<PermissionRequest | null>(null);
  const { exit } = useApp();

  // Permission gate ref — persists across renders
  const gateRef = useRef<TUIPermissionGate | null>(null);

  // Create PermissionService and gate once
  const permissionRef = useRef<PermissionService | null>(null);
  if (!permissionRef.current) {
    const client = config.model ? new AnthropicClient(config.model.apiKey, config.model.baseURL) : undefined;
    permissionRef.current = new PermissionService({
      initialMode: initialPermissionMode,
      gate: undefined as any, // set below after gate is created
      client,
      model: config.model?.model,
    });
    gateRef.current = new TUIPermissionGate(
      setApprovalRequest,
      () => {
        setPermissionMode('yolo');
        permissionRef.current?.setMode('yolo');
      },
    );
    permissionRef.current = new PermissionService({
      initialMode: initialPermissionMode,
      gate: gateRef.current,
      client,
      model: config.model?.model,
    });
  }
  const permissionService = permissionRef.current;

  // Multi-agent hook
  const { activeAgentId, activeAgentIdRef, setActiveAgentId, agentSessions, setAgentSessions, registryRef } = useMultiAgent();

  // Agent hook
  const { messages, setMessages, currentSession, setCurrentSession, tokenCount, agentRef } = useAgent(
    config, userPrompt, initialSession, sessionManager, sessionName, resumeRecent,
    setAgentSessions, registryRef,
    permissionService,
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

    const userText = result.promptText ?? value;
    setMessages(prev => [...prev, { role: 'user', content: userText, timestamp: new Date() }]);
    setIsLoading(true);
    try {
      await agentRef.current.run(userText);
    } catch (e) {
      if (e instanceof Error && e.message === 'Aborted') {
        setMessages(prev => [...prev, { role: 'status' as const, content: '(Aborted)', timestamp: new Date() }]);
      } else {
        throw e;
      }
    } finally {
      const agent = agentRef.current;
      if (agent) {
        await sessionManager.save(agent.currentSession, {
          model: config.model?.model || 'unknown',
          messages: agent.getMessages() as any,
          totalTokens: agent.getTokenCount(),
          createdAt: '',
          updatedAt: ''
        });
      }
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

  // Approval prompt input handler — active when an approval request is pending
  useInput((_input, key) => {
    if (!approvalRequest || !gateRef.current) return;
    if (_input === 'y' || key.return) {
      gateRef.current.resolve(true);
    } else if (_input === 'n' || key.escape) {
      gateRef.current.resolve(false);
    } else if (_input === 'a') {
      gateRef.current.resolveApproveAll();
    }
  }, { isActive: approvalRequest !== null });

  // Main input handler
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isLoading) {
        agentRef.current?.abort();
        if (approvalRequest && gateRef.current) {
          gateRef.current.resolve(false);
        }
      } else {
        exit();
      }
      return;
    }
    if (key.shift && key.tab) {
      const next = permissionService.cycleMode();
      setPermissionMode(next);
      return;
    }
    if (key.escape && isLoading) {
      agentRef.current?.abort();
      if (approvalRequest && gateRef.current) {
        gateRef.current.resolve(false);
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
            <Text bold color="yellow">Allow tool execution?</Text>
            <Text>{approvalRequest.displayText}</Text>
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
            <Box key={cmd.name}>
              <Text>{i === selectedSuggestion ? <Text color="cyan">{'> '}</Text> : '  '}</Text>
              <Text color={i === selectedSuggestion ? 'cyan' : 'white'} bold={i === selectedSuggestion}>
                /{cmd.name}
              </Text>
              <Text dimColor>{'  '}{cmd.description}</Text>
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
