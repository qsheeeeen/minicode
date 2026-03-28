#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { render } from 'ink';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent } from './agent.js';
import { getModelConfig, getCompressionThreshold, getThinkingConfig, getPromptFile } from './config.js';
import { SessionManager } from './utils/session.js';
import { CallbackDisplay, DisplayMessage } from './utils/display.js';
import { SessionDisplayImpl } from './utils/session-display.js';
import { CommandRegistry, type CommandContext } from './cli/commands.js';
import { loadGlobalPrompt, loadProjectPrompt } from './utils/prompts.js';

// Create command registry instance
const commandRegistry = new CommandRegistry();
import { Message } from './components/Message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(await import('fs/promises').then(fs => fs.readFile(packagePath, 'utf-8')));
const VERSION = packageJson.version;

// Parse CLI arguments
const args = process.argv.slice(2);
let modelOverride: string | undefined;
let initialPrompt: string | undefined;
let sessionName: string | undefined;
let resumeRecent = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--version' || arg === '-v') {
    console.log(`Mini Code v${VERSION}`);
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    console.log('Mini Code - A minimal coding agent with TUI\n');
    console.log('Usage: minicode [options] [prompt]\n');
    console.log('Options:');
    console.log('  --model <spec>    Model specification (e.g., glm-4.7@zhipu)');
    console.log('  --session <name>  Session name (creates new or resumes existing)');
    console.log('  --resume          Resume most recent session');
    console.log('  --version, -v     Show version');
    console.log('  --help, -h        Show this help');
    console.log('\nExamples:');
    console.log('  minicode                    # Start TUI');
    console.log('  minicode "list files"       # Start TUI and auto-run prompt');
    console.log('  minicode --session my-session # Use specific session');
    console.log('\nIn TUI mode:');
    console.log('  /compress       # Compress conversation history');
    console.log('  /new <name>     # Create new session');
    console.log('  /resume         # List and resume sessions');
    console.log('  /rename <name>  # Rename current session');
    console.log('  /exit           # Quit (or Ctrl+C)');
    process.exit(0);
  } else if (arg === '--model') {
    modelOverride = args[++i];
  } else if (arg === '--session') {
    sessionName = args[++i];
  } else if (arg === '--resume') {
    resumeRecent = true;
  } else if (!arg.startsWith('--')) {
    // Non-option argument is the initial prompt
    initialPrompt = arg;
  }
}

// Get configuration
const modelConfig = await getModelConfig(modelOverride ?? process.env.MODEL);
const compressionThreshold = await getCompressionThreshold();
const thinkingConfig = await getThinkingConfig();

// Load global and project prompts
const [globalPrompt, promptFile] = await Promise.all([
  loadGlobalPrompt(),
  getPromptFile()
]);
const projectPrompt = await loadProjectPrompt(process.cwd(), promptFile);
const promptFiles: string[] = [];
if (globalPrompt) promptFiles.push('~/.minicode/MINICODE.md');
if (projectPrompt) promptFiles.push(`./${promptFile}`);
const userPrompt = [globalPrompt, projectPrompt].filter(Boolean).join('\n\n');

if (!modelConfig) {
  console.error('Error: No valid model configuration found. Please set model in config.json');
  process.exit(1);
}

const sessionManager = new SessionManager();

// Determine initial session
let initialSession = 'default';
if (sessionName) {
  initialSession = sessionName;
} else if (resumeRecent) {
  const recent = await sessionManager.getMostRecent();
  initialSession = recent || `session-${Date.now()}`;
} else {
  initialSession = `session-${Date.now()}`;
}

// Context progress bar
function makeBar(used: number, total: number, width: number): string {
  const ratio = Math.min(1, used / total);
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Main App Component for TUI mode
function App({ initialPrompt }: { initialPrompt?: string }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [status, setStatus] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'chat' | 'session-list'>('chat');
  // Consolidated session list state
  const [sessionListState, setSessionListState] = useState<{
    sessions: Array<{ name: string }>;
    selectedIndex: number;
  }>({ sessions: [], selectedIndex: 0 });
  const [inputValue, setInputValue] = useState('');
  const [autoSubmitPending, setAutoSubmitPending] = useState(!!initialPrompt);

  const agentRef = useRef<Agent | null>(null);
  const streamingRef = useRef<string>('');
  const { exit } = useApp();

  // Helper functions for session list state
  const setSessionList = (sessions: Array<{ name: string }>) => {
    setSessionListState(prev => ({ ...prev, sessions }));
  };

  const setSelectedIndex = (index: number) => {
    setSessionListState(prev => ({ ...prev, selectedIndex: index }));
  };

  // Update streaming ref when state changes
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
      apiKey: modelConfig!.apiKey,
      baseURL: modelConfig!.baseURL,
      model: modelConfig!.model,
      contextLength: modelConfig!.contextLength,
      compressionThresholdRatio: compressionThreshold,
      thinkingEnabled: thinkingConfig.enabled,
      thinkingTokens: thinkingConfig.tokens,
      display: displayAdapter,
      userPrompt
    });

    agentRef.current = agent;

    // Load initial session
    const loadInitial = async () => {
      if (sessionName || resumeRecent) {
        const loaded = await agent.loadFromSession(initialSession);
        if (loaded) {
          // Load display messages using SessionDisplay
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

  // Handle input submission
  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || !agentRef.current) return;

    // Try command registry first
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

    // Regular message
    setMessages(prev => [...prev, { role: 'user', content: value, timestamp: new Date() }]);
    setIsLoading(true);
    try {
      await agentRef.current.run(value);
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  }, [exit]);

  // Auto-submit initial prompt if provided
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

  // Chat mode keyboard handling
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
          <Text color="green">{modelConfig!.provider}</Text>
          <Text dimColor>:</Text>
          <Text>{modelConfig!.model}</Text>
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
          tokenCount / (modelConfig?.contextLength || 200000) > 0.9 ? 'red' :
          tokenCount / (modelConfig?.contextLength || 200000) > 0.7 ? 'yellow' : 'green'
        }>
          {makeBar(tokenCount, modelConfig?.contextLength || 200000, 20)}
        </Text>
        <Text dimColor>│ </Text>
        <Text dimColor>{Math.min(100, Math.floor(tokenCount / (modelConfig?.contextLength || 200000) * 100))}%</Text>
      </Box>
    </Box>
  );
}

// Start TUI
render(<App initialPrompt={initialPrompt} />);
