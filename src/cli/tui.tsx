import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent } from '../agent.js';
import type { MessageParam } from '../llm/anthropic.js';
import type { ResolvedConfig } from '../config.js';
import { CallbackDisplay, DisplayMessage } from '../utils/display.js';
import { SessionDisplayImpl } from '../utils/session-display.js';
import { commandRegistry, type CommandContext } from './commands.js';
import { Message } from '../components/Message.js';
import type { SessionManager } from '../utils/session.js';
import { AgentRegistry, type AgentSession } from '../services/agent-registry.js';

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
}

// Context progress bar
function makeBar(used: number, total: number, width: number): string {
  const ratio = Math.min(1, used / total);
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
  resumeRecent
}: AppProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [status, setStatus] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'chat' | 'session-list'>('chat');
  const [sessionListState, setSessionListState] = useState<{
    sessions: Array<{ name: string }>;
    selectedIndex: number;
  }>({ sessions: [], selectedIndex: 0 });
  const [inputValue, setInputValue] = useState('');
  const [autoSubmitPending, setAutoSubmitPending] = useState(!!initialPrompt);

  // Multi-agent support
  const [activeAgentId, setActiveAgentId] = useState<string>('1');
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);

  const agentRef = useRef<Agent | null>(null);
  const registryRef = useRef<AgentRegistry | null>(null);
  const { exit } = useApp();

  const setSessionList = (sessions: Array<{ name: string }>) => {
    setSessionListState(prev => ({ ...prev, sessions }));
  };

  const setSelectedIndex = (index: number) => {
    setSessionListState(prev => ({ ...prev, selectedIndex: index }));
  };

  // Helper: Update main agent (id='1') messages in agentSessions
  const updateMainAgentMessages = (updater: (current: DisplayMessage[]) => DisplayMessage[]) => {
    setAgentSessions(prev => {
      const main = prev.find(s => s.id === '1');
      if (main) {
        return [{ ...main, messages: updater(main.messages) }];
      }
      return prev;
    });
  };

  // Initialize agent once
  useEffect(() => {
    // Create agent registry
    const registry = new AgentRegistry();
    registryRef.current = registry;

    // Set up update callback to sync agentSessions with registry
    registry.setUpdateCallback((sessions) => {
      setAgentSessions(sessions);
    });

    const displayAdapter = new CallbackDisplay({
      onMessage: (msg) => {
        // Only show main agent messages in default view
        if (activeAgentId === '1') {
          setMessages(prev => [...prev, msg]);
        }
      },
      onUpdateLast: (updater) => {
        if (activeAgentId === '1') {
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const copy = [...prev];
            copy[copy.length - 1] = updater(copy[copy.length - 1]);
            return copy;
          });
        }
      },
      onStatusUpdate: setStatus,
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
    });

    agentRef.current = agent;

    // Register main agent session
    registry.register({
      id: '1',
      type: 'main',
      agent,
      display: displayAdapter,
      messages: [],
      status: 'idle',
    });

    setAgentSessions([{
      id: '1',
      type: 'main',
      agent,
      display: displayAdapter,
      messages: [],
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
          const sessionDisplay = new SessionDisplayImpl(sessionManager);
          const displayMessages = await sessionDisplay.loadForTUI(initialSession);
          if (displayMessages.length > 0) {
            setMessages(displayMessages);
            updateMainAgentMessages(() => displayMessages);
          }
        } else if (sessionName) {
          const sysMsg = { role: 'system' as const, content: `Created new session: ${sessionName}`, timestamp: new Date() };
          setMessages([sysMsg]);
          updateMainAgentMessages(() => [sysMsg]);
        }
      }
    };
    loadInitial();

    return () => { agentRef.current = null; };
  }, []); // Empty deps - run only once

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
      exit
    };

    const isCommand = await commandRegistry.parseAndExecute(value, commandContext);
    if (isCommand) return;

    setMessages(prev => [...prev, { role: 'user', content: value, timestamp: new Date() }]);
    setIsLoading(true);
    try {
      await agentRef.current.run(value);
      // Auto-save session after each exchange
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
        const sessionName = sessionListState.sessions[sessionListState.selectedIndex]?.name;
        if (sessionName) {
          handleSubmit(`/resume ${sessionName}`);
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

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    // Ctrl+1~9 for agent switching
    if (key.ctrl && input >= '1' && input <= '9') {
      setActiveAgentId(input);
      // Update messages to show selected agent's messages
      const session = agentSessions.find(s => s.id === input);
      if (session) {
        setMessages(session.messages);
      }
    }
  }, { isActive: mode === 'chat' });

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
          {/* Agent switcher - only show if there are sub-agents */}
          {agentSessions.length > 1 && (
            <>
              {agentSessions.map(s => {
                const label = s.id === '1' ? 'M' : s.id;
                return (
                  <Text key={s.id} color={s.id === activeAgentId ? 'cyan' : 'dimColor'} bold={s.id === activeAgentId}>
                    [{label}]
                  </Text>
                );
              })}
              <Text dimColor> | </Text>
            </>
          )}
          <Text dimColor>{currentSession}</Text>
          {(isLoading || status) && <Text dimColor> | </Text>}
          {isLoading && <Text color="magenta">Running...</Text>}
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
              <Message key={i} role={msg.role} content={msg.content} isStreaming={msg.isStreaming} />
            ))}
          </Box>
        )}
        {/* Show hint if viewing sub-agent */}
        {activeAgentId !== '1' && (
          <Box marginTop={1}>
            <Text dimColor color="yellow">Press Ctrl+1 to return to main agent</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="blue" bold>{isLoading ? '...' : '> '}</Text>
        <TextInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={async (value) => {
            setInputValue('');
            await handleSubmit(value);
          }}
          placeholder="Type a message or /command..."
        />
      </Box>

      {/* Status bar: tokens + context progress */}
      <Box paddingX={1}>
        <Text dimColor>{tokenCount.toLocaleString()}/{(config.model?.contextLength || 200000).toLocaleString()}</Text>
        <Text dimColor> │</Text>
        <Text color={
          tokenCount / (config.model?.contextLength || 200000) > config.compressionThreshold ? 'red' :
          tokenCount / (config.model?.contextLength || 200000) > config.compressionThreshold * 0.875 ? 'yellow' : 'green'
        }>
          {makeBar(tokenCount, config.model?.contextLength || 200000, 20)}
        </Text>
        <Text dimColor>│ </Text>
        <Text dimColor>{Math.min(100, Math.floor(tokenCount / (config.model?.contextLength || 200000) * 100))}%</Text>
      </Box>
    </Box>
  );
}
