import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commandRegistry, type CommandContext } from './commands/index.js';

const createMockContext = (): CommandContext => ({
  agent: {} as any,
  sessionManager: {} as any,
  setMessages: vi.fn(),
  setCurrentSession: vi.fn(),
  setMode: vi.fn(),
  setSessionList: vi.fn(),
  setSelectedIndex: vi.fn(),
  exit: vi.fn(),
});

describe('commandRegistry', () => {
  let originalCommands: Map<string, any>;

  beforeEach(() => {
    // Save original commands
    originalCommands = new Map((commandRegistry as any).commands);
    // Clear for testing
    (commandRegistry as any).commands = new Map();
  });

  describe('register', () => {
    it('registers command with handler', async () => {
      const handler = vi.fn();
      commandRegistry.register({ name: 'test', description: 'Test command', handler });
      const result = await commandRegistry.parseAndExecute('/test', createMockContext());
      expect(result.handled).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    it('registers command with prompt', async () => {
      commandRegistry.register({ name: 'idea', description: 'Share ideas', prompt: () => 'Here is my idea' });
      const result = await commandRegistry.parseAndExecute('/idea', createMockContext());
      expect(result.handled).toBe(true);
      expect(result.promptText).toBe('Here is my idea');
    });

    it('throws when neither handler nor prompt provided', () => {
      expect(() => commandRegistry.register({ name: 'bad', description: 'Invalid' } as any)).toThrow('must have either handler or prompt');
    });

    it('throws when both handler and prompt provided', () => {
      expect(() => commandRegistry.register({
        name: 'bad',
        description: 'Invalid',
        handler: vi.fn(),
        prompt: () => 'text',
      } as any)).toThrow('cannot have both handler and prompt');
    });
  });

  describe('parseAndExecute', () => {
    it('returns handled=false for non-command input', async () => {
      const result = await commandRegistry.parseAndExecute('hello', createMockContext());
      expect(result.handled).toBe(false);
    });

    it('strips leading slash', async () => {
      const handler = vi.fn();
      commandRegistry.register({ name: 'cmd', description: 'Test', handler });
      await commandRegistry.parseAndExecute('/cmd arg1 arg2', createMockContext());
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toEqual(['arg1', 'arg2']);
    });

    it('trims whitespace', async () => {
      const handler = vi.fn();
      commandRegistry.register({ name: 'cmd', description: 'Test', handler });
      await commandRegistry.parseAndExecute('/cmd  arg1  ', createMockContext());
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toEqual(['arg1']);
    });

    it('returns handled=false for unknown command', async () => {
      const result = await commandRegistry.parseAndExecute('/unknown', createMockContext());
      expect(result.handled).toBe(false);
    });
  });

  describe('getCommandNames', () => {
    it('returns all registered command names', () => {
      commandRegistry.register({ name: 'cmd1', description: 'One', handler: vi.fn() });
      commandRegistry.register({ name: 'cmd2', description: 'Two', handler: vi.fn() });
      expect(commandRegistry.getCommandNames()).toContain('cmd1');
      expect(commandRegistry.getCommandNames()).toContain('cmd2');
    });
  });

  describe('getCommandList', () => {
    it('returns command names and descriptions', () => {
      commandRegistry.register({ name: 'test', description: 'A test command', handler: vi.fn() });
      const list = commandRegistry.getCommandList();
      expect(list).toContainEqual({ name: 'test', description: 'A test command' });
    });
  });

  describe('getHelp', () => {
    it('formats help text', () => {
      commandRegistry.register({ name: 'exit', description: 'Exit the app', handler: vi.fn() });
      const help = commandRegistry.getHelp();
      expect(help).toContain('/exit - Exit the app');
    });
  });
});
