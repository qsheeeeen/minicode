#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { render } from 'ink';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent } from './agent.js';
import { getModelConfig, getCompressionThreshold, getThinkingConfig } from './config.js';
import { SessionManager } from './utils/session.js';
import { CallbackDisplay, ConsoleDisplay, DisplayCallback, DisplayAdapter, DisplayMessage } from './utils/display.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const packagePath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(await import('fs/promises').then(fs => fs.readFile(packagePath, 'utf-8')));
const VERSION = packageJson.version;

// Parse CLI arguments
const args = process.argv.slice(2);
let modelOverride: string | undefined;
let directPrompt: string | undefined;
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
    console.log('  minicode                        # Start TUI mode');
    console.log('  minicode "list files"           # Run prompt directly');
    console.log('  minicode --session feature-a    # Use specific session');
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
    // Non-option argument is the prompt
    directPrompt = arg;
  }
}

// Get configuration
const modelConfig = await getModelConfig(modelOverride ?? process.env.MODEL);
const compressionThreshold = await getCompressionThreshold();
const thinkingConfig = await getThinkingConfig();

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

// Direct prompt mode (non-TUI)
async function runDirect(prompt: string) {
  const display = new ConsoleDisplay();
  const agent = new Agent(
    modelConfig!.apiKey,
    modelConfig!.baseURL,
    modelConfig!.model,
    modelConfig!.contextLength,
    compressionThreshold,
    thinkingConfig.enabled,
    thinkingConfig.tokens,
    display
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  agent.startNewSession(`direct-${timestamp}`);

  console.log(`Mini Code v${VERSION}`);
  console.log(`Model: ${modelConfig!.provider}:${modelConfig!.model}`);
  console.log('---');
  await agent.run(prompt);
}

// Main App Component for TUI mode
function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentSession, setCurrentSession] = useState(initialSession);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [status, setStatus] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'chat' | 'session-list'>('chat');
  const [sessionList, setSessionList] = useState<Array<{ name: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');

  const agentRef = useRef<Agent | null>(null);
  const streamingRef = useRef<string>('');
  const { exit } = useApp();

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

    const agent = new Agent(
      modelConfig!.apiKey,
      modelConfig!.baseURL,
      modelConfig!.model,
      modelConfig!.contextLength,
      compressionThreshold,
      thinkingConfig.enabled,
      thinkingConfig.tokens,
      displayAdapter
    );

    agentRef.current = agent;

    // Load initial session
    const loadInitial = async () => {
      if (sessionName || resumeRecent) {
        const loaded = await agent.loadFromSession(initialSession, false);
        if (!loaded && sessionName) {
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

    if (value === '/exit') { exit(); return; }
    if (value === '/compress') {
      setIsLoading(true);
      await agentRef.current.compress();
      setIsLoading(false);
      return;
    }
    if (value.startsWith('/new ')) {
      const name = value.slice(5).trim();
      if (name) {
        agentRef.current.startNewSession(name);
        setCurrentSession(name);
        setMessages([{ role: 'system', content: `Created session: ${name}`, timestamp: new Date() }]);
      }
      return;
    }
    if (value.startsWith('/rename ')) {
      const newName = value.slice(8).trim();
      if (newName) {
        const oldName = agentRef.current.currentSession;
        await sessionManager.rename(oldName, newName);
        agentRef.current.currentSession = newName;
        setCurrentSession(newName);
        setMessages(prev => [...prev, { role: 'system', content: `Renamed: ${oldName} -> ${newName}`, timestamp: new Date() }]);
      }
      return;
    }
    if (value.startsWith('/resume ')) {
      const arg = value.slice(8).trim();
      const loaded = await agentRef.current.loadFromSession(arg, false);
      if (loaded) {
        setCurrentSession(arg);
        setMessages([{ role: 'system', content: `Loaded session: ${arg}`, timestamp: new Date() }]);
      } else {
        setMessages(prev => [...prev, { role: 'error', content: `Session not found: ${arg}`, timestamp: new Date() }]);
      }
      return;
    }

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

  // Session list overlay
  if (mode === 'session-list') {
    useInput((input, key) => {
      if (key.return) {
        handleSubmit(`/resume ${sessionList[selectedIndex]?.name}`);
        setMode('chat');
      } else if (key.escape) {
        setMode('chat');
      } else if (key.upArrow) {
        setSelectedIndex(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex(i => Math.min(sessionList.length - 1, i + 1));
      }
    });

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="double" borderColor="blue">
        <Text bold color="blue" underline>Sessions</Text>
        <Text dimColor> ↑↓ navigate, Enter select, Esc cancel</Text>
        {sessionList.map((s, i) => (
          <Text key={s.name} color={i === selectedIndex ? 'blue' : 'white'} bold={i === selectedIndex}>
            {i === selectedIndex ? '> ' : '  '}{s.name}
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
        </Box>
        <Box>
          <Text dimColor>{currentSession}</Text>
          <Text dimColor> | </Text>
          <Text color={tokenCount > 100000 ? 'yellow' : 'blue'}>{tokenCount.toLocaleString()}T</Text>
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
            {messages.map((msg, i) => {
              const color = msg.role === 'user' ? 'blue' : msg.role === 'error' ? 'red' : msg.role === 'tool' ? 'yellow' : msg.role === 'system' ? 'gray' : 'white';
              const prefix = msg.role === 'user' ? '> ' : msg.role === 'tool' ? '🔧 ' : msg.role === 'error' ? '❌ ' : msg.role === 'system' ? 'ℹ️ ' : '';
              return (
                <Box key={i} marginBottom={1}>
                  <Text color={color}>{prefix}{msg.content}</Text>
                </Box>
              );
            })}
            {isStreaming && (
              <Box marginBottom={1}>
                <Text color="white">{streamingContent}</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="blue" bold>{isLoading ? '⏳ ' : '> '}</Text>
        <TextInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={async (value) => {
            setInputValue('');
            if (value === '/resume' || value.startsWith('/resume ')) {
              const arg = value.slice(8).trim();
              if (!arg) {
                const sessions = await sessionManager.list();
                setSessionList(sessions.map(s => ({ name: s.name })));
                setSelectedIndex(0);
                setMode('session-list');
              } else {
                await handleSubmit(value);
              }
            } else {
              await handleSubmit(value);
            }
          }}
          placeholder="Type a message or /command..."
        />
      </Box>
    </Box>
  );
}

// Start TUI or direct mode
if (directPrompt) {
  await runDirect(directPrompt);
} else {
  render(<App />);
}
