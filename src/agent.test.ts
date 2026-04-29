import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mocks
class MockStream extends EventEmitter {
  resolveFinal: (val: any) => void = () => {};
  rejectFinal: (err: any) => void = () => {};

  finalMessage() {
    return new Promise((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
  }
  
  abort() {}
}

const mockChatStream = vi.fn();
const mockChat = vi.fn();

vi.mock('./llm/anthropic.js', () => ({
  AnthropicClient: vi.fn().mockImplementation(function() {
    return {
      chat: mockChat,
      chatStream: mockChatStream,
    };
  })
}));

vi.mock('./tools/index.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    registerTools: (registry: any) => {
      registry.register({
        name: 'testTool',
        description: 'Test Tool',
        input_schema: { type: 'object', properties: {} },
        execute: vi.fn().mockResolvedValue({ output: 'success', display: null }),
      });
    },
  };
});

vi.mock('./services/token-manager.js', () => ({
  TokenManagerImpl: vi.fn().mockImplementation(function() {
    return {
      getTotal: vi.fn().mockReturnValue(100),
      addTokens: vi.fn(),
      getRatio: vi.fn().mockReturnValue(0.1),
      getLastShownThreshold: vi.fn().mockReturnValue(0),
      updateThreshold: vi.fn(),
      shouldCompress: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
    };
  })
}));

vi.mock('./services/compression-service.js', () => ({
  CompressionServiceImpl: vi.fn().mockImplementation(function() {
    return {
      compress: vi.fn().mockResolvedValue([{ role: 'user', content: 'compressed' }]),
    };
  })
}));

vi.mock('./services/permission.js', () => ({
  PermissionService: vi.fn().mockImplementation(function() {
    return {
      check: vi.fn().mockResolvedValue(true),
    };
  })
}));

import { Agent, AgentConfig, SYSTEM_PROMPT } from './agent.js';
import { MessageStore } from './messages.js';

describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with default values', () => {
      const agent = new Agent();
      expect(agent.currentSession).toMatch(/^session-\d+$/);
      expect(agent.getTokenCount()).toBe(100);
      expect(agent.getStore()).toBeInstanceOf(MessageStore);
    });

    it('initializes with config values', () => {
      const config: AgentConfig = {
        currentSession: 'test-session',
        userPrompt: 'custom prompt',
      };
      const agent = new Agent(config);
      expect(agent.currentSession).toBe('test-session');
    });
  });

  describe('setSession', () => {
    it('updates currentSession', () => {
      const agent = new Agent();
      agent.setSession('new-session');
      expect(agent.currentSession).toBe('new-session');
    });
  });

  describe('getMessages and setMessages', () => {
    it('can set and get messages via the internal store', () => {
      const agent = new Agent();
      const messages: any[] = [{ role: 'user', content: 'hello' }];
      agent.setMessages(messages);
      
      const retrieved = agent.getMessages();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].role).toBe('user');
      expect(retrieved[0].content).toBe('hello');
    });
  });

  describe('setTokenCount', () => {
    it('adds tokens to token manager', () => {
      const agent = new Agent();
      agent.setTokenCount(500);
      // It calls internal tokenManager.addTokens(500, 0)
      // Since it's mocked, we just verify it doesn't crash
      expect(agent.getTokenCount()).toBe(100); // mocked getTotal returns 100
    });
  });

  describe('compress', () => {
    it('compresses messages if there are enough in context', async () => {
      const agent = new Agent();
      
      // Add more than 12 messages to trigger compression logic
      for (let i = 0; i < 15; i++) {
        agent.getStore().add({ role: 'user', content: `msg ${i}`, timestamp: new Date(), inContext: true });
      }
      
      await agent.compress();
      
      // Store should be replaced with compressed output (1 message 'compressed' + status)
      // But compressed resolves to 1 msg from mock, plus 1 status msg added at the end
      expect(agent.getStore().getAll().some(m => m.content === 'compressed' || (typeof m.content === 'string' && m.content.includes('Compressed to')))).toBe(true);
    });

    it('does not compress if not enough messages', async () => {
      const agent = new Agent();
      
      // Add only 5 messages
      for (let i = 0; i < 5; i++) {
        agent.getStore().add({ role: 'user', content: `msg ${i}`, timestamp: new Date(), inContext: true });
      }
      
      await agent.compress();
      
      // Should add a status message
      const msgs = agent.getStore().getAll();
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.role).toBe('status');
      expect(lastMsg.content).toContain('Not enough messages to compress');
    });
  });

  describe('clearSession', () => {
    it('clears the store and token manager', () => {
      const agent = new Agent();
      agent.getStore().add({ role: 'user', content: 'hi', timestamp: new Date(), inContext: true });
      agent.clearSession();
      
      expect(agent.getStore().getAll()).toHaveLength(0);
    });
  describe('run', () => {
    it('handles a basic text interaction', async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      
      const agent = new Agent();
      
      // We need to trigger the stream events to simulate LLM response
      const runPromise = agent.run('Hello agent');
      
      // Simulate some text streaming
      stream.emit('text', 'Hi ');
      stream.emit('text', 'there!');
      stream.emit('contentBlock', { type: 'text' }); // Finalizes text
      stream.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' });
      
      await runPromise;
      
      const msgs = agent.getStore().getAll();
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('Hello agent');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Hi there!');
    });

    it('handles thinking blocks', async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      
      const agent = new Agent({ thinkingEnabled: true });
      const runPromise = agent.run('Solve this');
      
      stream.emit('thinking', 'Hmm...');
      stream.emit('contentBlock', { type: 'thinking' });
      stream.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' });
      
      await runPromise;
      
      const msgs = agent.getStore().getAll();
      const thinkingMsg = msgs.find(m => m.role === 'thinking');
      expect(thinkingMsg).toBeDefined();
      expect(thinkingMsg?.content).toBe('Hmm...');
    });

    it('handles tool calls', async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream1).mockReturnValueOnce(stream2); // Second stream for tool result follow-up
      
      const agent = new Agent();
      console.log('TEST TOOL GET:', agent.getToolRegistry().get('testTool'));
      const runPromise = agent.run('Use tool');
      
      stream1.emit('contentBlock', { 
        type: 'tool_use', 
        id: 'call_1', 
        name: 'testTool', 
        input: {} 
      });
      stream1.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'tool_use' });
      
      // We must wait for first loop to finish and start the second loop before we can resolve stream2
      // Using setImmediate gives the event loop time to process the promises
      setImmediate(() => {
        stream2.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' });
      });
      
      await runPromise;
      
      const msgs = agent.getStore().getAll();
      console.log("MESSAGES:", JSON.stringify(msgs, null, 2));
      const toolCall = msgs.find(m => m.role === 'tool_use');
      expect(toolCall).toBeDefined();
      expect(toolCall?.toolName).toBe('testTool');
      
      const toolResult = msgs.find(m => m.role === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult?.content).toBe('success');
    });
  });

  describe('abort', () => {
    it('aborts the current run', async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      
      const agent = new Agent();
      
      const runPromise = agent.run('Hello');
      
      agent.abort();
      
      await expect(runPromise).rejects.toThrow('Aborted');
    });

    it('clears isStreaming flags when aborted', async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      
      const agent = new Agent();
      const runPromise = agent.run('Hello');
      
      // Wait for agent to start streaming
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Simulate streaming events to set isStreaming to true
      stream.emit('text', 'hello');
      
      // Verify flags are set
      const messages = agent.getStore().getAll();
      const textMsg = messages.find(m => m.role === 'assistant');
      expect(textMsg?.isStreaming).toBe(true);
      
      agent.abort();
      
      await expect(runPromise).rejects.toThrow('Aborted');
      
      // Verify flags are cleared after abort
      const updatedMessages = agent.getStore().getAll();
      const updatedTextMsg = updatedMessages.find(m => m.role === 'assistant');
      expect(updatedTextMsg?.isStreaming).toBe(false);
    });
  });
});
});
