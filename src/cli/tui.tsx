import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent } from '../agent.js';
import type { ResolvedConfig } from '../config.js';
import { CallbackDisplay, DisplayMessage } from '../utils/display.js';
import { SessionDisplayImpl } from '../utils/session-display.js';
import { commandRegistry, type CommandContext } from './commands.js';
import { Message } from '../components/Message.js';
import type { SessionManager } from '../utils/session.js';

export interface AppProps {
  config: ResolvedConfig;
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
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

  const agentRef = useRef<Agent | null>(null);
  const streamingRef = useRef<string>('');
  const { exit } = useApp();

  const setSessionList = (sessions: Array<{ name: string }>) => {
    setSessionListState(prev => ({ ...prev, sessions }));
  };

  const setSelectedIndex = (index: number) => {
    setSessionListState(prev => ({ ...prev, selectedIndex: index }));
  };

  useEffect(() => {
    streamingRef.current = streamingContent;
  }, [streamingContent]);

  // Initialize agent once
  useEffect(() => {
    const displayAdapter = new CallbackDisplay({
      onMessage: (msg) => setMessages(prev => [...prev, msg]),
      onStreamStart: () => { setIsStreaming(true); setStreamingContent(''); streamingRef.current = ''; },
      onStreamChunk: (chunk) => {
        const newContent = streamingRef.current + chunk;
        streamingRef.current = newContent;
        setStreamingContent(newContent);
      },
      onStreamEnd: () => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: streamingRef.current,
          timestamp: new Date()
        }]);
        setIsStreaming(false);
        setStreamingContent('');
        streamingRef.current = '';
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
      sessionName: initialSession
    });

    agentRef.current = agent;

    // Load initial session
    const loadInitial = async () => {
      if (sessionName || resumeRecent) {
        const loaded = await agent.loadFromSession(initialSession);
        if (loaded) {
          const sessionDisplay = new SessionDisplayImpl(sessionManager);
          const displayMessages = await sessionDisplay.loadForTUI(initialSession);
          if (displayMessages.length > 0) {
            setMessages(displayMessages);
          }
        } else if (sessionName) {
          setMessages([{ role: 'system', content: `Created new session: ${sessionName}`, timestamp: new Date() }]);
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
      if (key.return) {
        handleSubmit(`/resume ${sessionListState.sessions[sessionListState.selectedIndex]?.name}`);
        setMode('chat');
      } else if (key.escape) {
        setMode('chat');
      } else if (key.upArrow) {
        setSessionListState(prev => ({ ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) }));
      } else if (key.downArrow) {
        setSessionListState(prev => ({ ...prev, selectedIndex: Math.min(prev.sessions.length - 1, prev.selectedIndex + 1) }));
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
  }, { isActive: mode === 'chat' });

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Box flexGrow={1}>
          <Text bold color="cyan">Mini Code</Text>
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
          <Text dimColor>{currentSession}</Text>
          {(isLoading || status) && <Text dimColor> | </Text>}
          {isLoading && <Text color="magenta">Running...</Text>}
          {status && !isLoading && <Text color="magenta">{status}</Text>}
        </Box>
      </Box>

      {/* Messages */}
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {messages.length === 0 && !isStreaming ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Text dimColor>Type a message to start...</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {messages.map((msg, i) => (
              <Message key={i} role={msg.role} content={msg.content} />
            ))}
            {isStreaming && (
              <Box marginBottom={0}>
                <Text>{streamingContent}</Text>
                <Text dimColor inverse>▋</Text>
              </Box>
            )}
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
        <Text dimColor>{tokenCount.toLocaleString()}T</Text>
        <Text dimColor> │</Text>
        <Text color={
          tokenCount / (config.model?.contextLength || 200000) > 0.9 ? 'red' :
          tokenCount / (config.model?.contextLength || 200000) > 0.7 ? 'yellow' : 'green'
        }>
          {makeBar(tokenCount, config.model?.contextLength || 200000, 20)}
        </Text>
        <Text dimColor>│ </Text>
        <Text dimColor>{Math.min(100, Math.floor(tokenCount / (config.model?.contextLength || 200000) * 100))}%</Text>
      </Box>
    </Box>
  );
}
