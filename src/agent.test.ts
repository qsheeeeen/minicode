import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
    return { chat: mockChat, chatStream: mockChatStream };
  }),
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
        execute: vi.fn().mockResolvedValue({ output: 'success' }),
      });
    },
  };
});

vi.mock('./services/token-manager.js', () => ({
  TokenManager: vi.fn().mockImplementation(function() {
    return {
      getTotal: vi.fn().mockReturnValue(100),
      addTokens: vi.fn(),
      getRatio: vi.fn().mockReturnValue(0.1),
      getLastShownThreshold: vi.fn().mockReturnValue(0),
      updateThreshold: vi.fn(),
      shouldCompress: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
    };
  }),
}));

vi.mock('./services/compression-service.js', () => ({
  CompressionService: vi.fn().mockImplementation(function() {
    return {
      compress: vi.fn().mockResolvedValue([{ role: 'user', content: 'compressed' }]),
    };
  }),
}));

vi.mock('./services/permission.js', () => ({
  PermissionService: vi.fn().mockImplementation(function() {
    return { check: vi.fn().mockResolvedValue(true) };
  }),
}));

vi.mock('./utils/session.js', () => ({
  sessionManager: {
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./cli/skills/index.js', () => ({
  skillRegistry: {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  },
}));

import { Agent } from './agent.js';
import { MessageStore } from './messages.js';

describe('Agent', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('constructor', () => {
    it('initializes with default values', () => {
      const agent = new Agent();
      expect(agent.currentSession).toMatch(/^session-\d+$/);
      expect(agent.getTokenCount()).toBe(100);
      expect(agent.getStore()).toBeInstanceOf(MessageStore);
    });

    it('initializes with config values', () => {
      const agent = new Agent({ userPrompt: 'custom' });
      agent.setSession('test-session');
      expect(agent.currentSession).toBe('test-session');
    });
  });

  describe('getMessages and setMessages', () => {
    it('setMessages stores turns directly', () => {
      const agent = new Agent();
      const messages: any[] = [{ role: 'user', content: 'hello' }];
      agent.setMessages(messages);
      expect(agent.getMessages()).toEqual(messages);
      expect(agent.getStore().getTurns()).toEqual(messages);
    });

    it('getMessages returns store turns', () => {
      const agent = new Agent();
      agent.getStore().addUserMessage('hello');
      expect(agent.getMessages()).toEqual([{ role: 'user', content: 'hello' }]);
    });
  });

  describe('compress', () => {
    it('does not compress if not enough turns', async () => {
      const agent = new Agent();
      for (let i = 0; i < 5; i++) {
        agent.getStore().addUserMessage(`msg ${i}`);
      }
      await agent.compress();
      const statuses = agent.getStore().getStatuses();
      expect(statuses.some(s => s.content.includes('Not enough'))).toBe(true);
    });
  });

  describe('clearSession', () => {
    it('clears the store', () => {
      const agent = new Agent();
      agent.getStore().addUserMessage('hi');
      agent.clearSession();
      expect(agent.getStore().getTurns()).toHaveLength(0);
    });
  });

  describe('run', () => {
    it('handles a basic text interaction', async () => {
      const stream = new MockStream();
      mockChatStream.mockReturnValueOnce(stream);
      const agent = new Agent();
      const runPromise = agent.run('Hello agent');

      stream.emit('text', 'Hi ');
      stream.emit('text', 'there!');
      stream.emit('contentBlock', { type: 'text' });
      stream.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' });

      await runPromise;
      const turns = agent.getStore().getTurns();
      expect(turns[0]).toEqual({ role: 'user', content: 'Hello agent' });
      expect(turns[1].role).toBe('assistant');
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
      const turns = agent.getStore().getTurns();
      const content = turns[1].content as any[];
      expect(content.some((b: any) => b.type === 'thinking')).toBe(true);
    });

    it('handles tool calls', async () => {
      const stream1 = new MockStream();
      const stream2 = new MockStream();
      mockChatStream.mockReturnValueOnce(stream1).mockReturnValueOnce(stream2);

      const agent = new Agent();
      const runPromise = agent.run('Use tool');

      stream1.emit('contentBlock', { type: 'tool_use', id: 'call_1', name: 'testTool', input: {} });
      stream1.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'tool_use' });

      setImmediate(() => {
        stream2.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' });
      });

      await runPromise;
      const turns = agent.getStore().getTurns();
      const assistantContent = turns[1].content as any[];
      expect(assistantContent.some((b: any) => b.type === 'tool_use')).toBe(true);
      expect(turns[2].role).toBe('user');
      expect(Array.isArray(turns[2].content)).toBe(true);
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
  });
});
