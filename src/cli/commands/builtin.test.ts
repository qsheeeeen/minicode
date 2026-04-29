import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { commandRegistry, CommandContext } from './index.js';

// Setup mock before loading the module
vi.mock('./index.js', () => ({
  commandRegistry: {
    register: vi.fn(),
  }
}));

// Load the module to execute the register calls
import './builtin.js';

describe('Builtin commands', () => {
  let registerCalls: any[];
  let handlers: Record<string, any> = {};

  beforeAll(() => {
    // Capture the calls made during module load
    registerCalls = (commandRegistry.register as any).mock.calls.slice();
    handlers = registerCalls.reduce((acc: any, call: any[]) => {
      acc[call[0].name] = call[0].handler || call[0].prompt;
      return acc;
    }, {});
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('registers expected commands', () => {
    const registeredNames = registerCalls.map((call: any[]) => call[0].name);

    expect(registeredNames).toContain('exit');
    expect(registeredNames).toContain('clear');
    expect(registeredNames).toContain('compress');
    expect(registeredNames).toContain('new');
    expect(registeredNames).toContain('rename');
    expect(registeredNames).toContain('resume');
    expect(registeredNames).toContain('plan');
    expect(registeredNames).toContain('test');
  });

  function makeStoreMock() {
    return { add: vi.fn() };
  }

  function makeAgentMock(overrides: Record<string, any> = {}) {
    const store = makeStoreMock();
    return { getStore: vi.fn().mockReturnValue(store), ...overrides, __store: store };
  }

  describe('handlers', () => {
    it('/exit calls ctx.exit()', async () => {
      const ctx: Partial<CommandContext> = { exit: vi.fn() };
      await handlers['exit']([], ctx as CommandContext);
      expect(ctx.exit).toHaveBeenCalled();
    });

    it('/compress calls ctx.agent.compress() and adds status via store', async () => {
      const agentMock = makeAgentMock({ compress: vi.fn().mockResolvedValue(undefined) });
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
      };

      await handlers['compress']([], ctx as CommandContext);
      expect(agentMock.compress).toHaveBeenCalled();
      expect(agentMock.__store.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'status' }));
    });

    it('/clear clears session and adds status via store', async () => {
      const agentMock = makeAgentMock({
        clearSession: vi.fn(),
        setTokenCount: vi.fn(),
        setSession: vi.fn(),
      });
      const sessionManagerMock = {
        getProjectHash: vi.fn().mockReturnValue('testhash'),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        sessionManager: sessionManagerMock as any,
        setCurrentSession: vi.fn(),
        setMessages: vi.fn(),
      };

      await handlers['clear']([], ctx as CommandContext);
      expect(agentMock.clearSession).toHaveBeenCalled();
      expect(agentMock.setTokenCount).toHaveBeenCalledWith(0);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith(expect.stringMatching(/^session-/));
      expect(agentMock.__store.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'status' }));
    });

    it('/new creates new session and adds status via store', async () => {
      const agentMock = makeAgentMock({
        clearSession: vi.fn(),
        setSession: vi.fn(),
      });
      const sessionManagerMock = {
        getProjectHash: vi.fn().mockReturnValue('testhash'),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        sessionManager: sessionManagerMock as any,
        setCurrentSession: vi.fn(),
      };

      await handlers['new'](['my', 'new', 'session'], ctx as CommandContext);
      expect(agentMock.clearSession).toHaveBeenCalled();
      expect(agentMock.setSession).toHaveBeenCalledWith('my new session', expect.anything());
      expect(ctx.setCurrentSession).toHaveBeenCalledWith('my new session');
      expect(agentMock.__store.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'status' }));
    });

    it('/rename renames session and adds status via store', async () => {
      const storeMock = makeStoreMock();
      const agentMock = {
        currentSession: 'old-session',
        setSession: vi.fn(),
        getStore: vi.fn().mockReturnValue(storeMock),
      };
      const sessionManagerMock = {
        getProjectHash: vi.fn().mockReturnValue('testhash'),
        rename: vi.fn().mockResolvedValue(undefined),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        sessionManager: sessionManagerMock as any,
        setCurrentSession: vi.fn(),
      };

      await handlers['rename'](['new-session'], ctx as CommandContext);
      expect(sessionManagerMock.rename).toHaveBeenCalledWith('old-session', 'new-session');
      expect(ctx.setCurrentSession).toHaveBeenCalledWith('new-session');
      expect(storeMock.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'status' }));
    });

    it('/resume with no args lists sessions', async () => {
      const sessionManagerMock = {
        list: vi.fn().mockResolvedValue([{ name: 'session-1' }, { name: 'session-2' }]),
      };
      const ctx: Partial<CommandContext> = {
        sessionManager: sessionManagerMock as any,
        setInputMode: vi.fn(),
      };

      await handlers['resume']([], ctx as CommandContext);
      expect(sessionManagerMock.list).toHaveBeenCalled();
      expect(ctx.setInputMode).toHaveBeenCalledWith('session-list', { sessions: [{ name: 'session-1' }, { name: 'session-2' }] });
    });

    it('/resume with args loads session', async () => {
      const storeMock = { add: vi.fn() };
      const agentMock = {
        setMessages: vi.fn(),
        setTokenCount: vi.fn(),
        setSession: vi.fn(),
        getToolRegistry: vi.fn(),
        getStore: vi.fn().mockReturnValue(storeMock),
      };
      const sessionManagerMock = {
        getProjectHash: vi.fn().mockReturnValue('testhash'),
        get: vi.fn().mockResolvedValue({
          messages: [],
          totalTokens: 100,
        }),
      };
      const ctx: Partial<CommandContext> = {
        agent: agentMock as any,
        sessionManager: sessionManagerMock as any,
        setCurrentSession: vi.fn(),
        setMessages: vi.fn(),
      };

      await handlers['resume'](['session-1'], ctx as CommandContext);
      expect(sessionManagerMock.get).toHaveBeenCalledWith('session-1');
      expect(agentMock.setMessages).toHaveBeenCalled();
      expect(agentMock.setTokenCount).toHaveBeenCalledWith(100);
      expect(ctx.setCurrentSession).toHaveBeenCalledWith('session-1');
      expect(storeMock.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'status' }));
    });

    it('/resume with unknown session shows error', async () => {
      const storeMock = { add: vi.fn() };
      const sessionManagerMock = {
        get: vi.fn().mockResolvedValue(null),
      };
      const ctx: Partial<CommandContext> = {
        agent: { getStore: vi.fn().mockReturnValue(storeMock) } as any,
        sessionManager: sessionManagerMock as any,
        setMessages: vi.fn(),
      };

      await handlers['resume'](['unknown'], ctx as CommandContext);
      expect(storeMock.add).toHaveBeenCalledWith(expect.objectContaining({ role: 'error' }));
    });

    it('/plan returns prompt text', () => {
      const result = handlers['plan']();
      expect(typeof result).toBe('string');
      expect(result).toContain('executable plan');
    });

    it('/test returns prompt text', () => {
      const result = handlers['test']();
      expect(typeof result).toBe('string');
      expect(result).toContain('Run a simple test of all available tools');
    });
  });
});
