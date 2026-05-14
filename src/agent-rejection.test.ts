import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Agent } from './agent.js';
import { ToolDeniedError } from './tools/index.js';

class MockStream extends EventEmitter {
  private _finalResult: any = null;
  private _resolve: ((val: any) => void) | null = null;

  resolveFinal(val: any) {
    if (this._resolve) {
      this._resolve(val);
    } else {
      this._finalResult = val;
    }
  }

  finalMessage() {
    return new Promise((resolve) => {
      if (this._finalResult) {
        resolve(this._finalResult);
      } else {
        this._resolve = resolve;
      }
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
        requiresPermission: true,
        execute: vi.fn().mockResolvedValue({ output: 'success' }),
      });
    },
  };
});

describe('Agent Rejection Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('in manual mode, rejection stops the conversation', async () => {
    const agent = new Agent();
    agent.setPermissionMode('manual');
    
    // Mock PermissionService to return denied
    const permissionService = agent.getPermissionService();
    vi.spyOn(permissionService, 'check').mockResolvedValue({ 
      allowed: false, 
      reason: 'User rejected' 
    });

    const stream = new MockStream();
    mockChatStream.mockReturnValueOnce(stream);

    const runPromise = agent.run('do something');

    // Simulate tool call
    stream.emit('contentBlock', { type: 'tool_use', id: 'call_1', name: 'testTool', input: {} });
    stream.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'tool_use' });

    await runPromise;

    const turns = agent.getStore().getTurns();
    // turns: [user msg, assistant tool_use, user tool_result]
    expect(turns).toHaveLength(3);
    const lastTurn = turns[2];
    expect(lastTurn.role).toBe('user');
    expect((lastTurn.content as any)[0].content).toBe('User rejected');
    
    // Status should show error
    const statuses = agent.getStore().getStatuses();
    expect(statuses.some(s => s.role === 'error' && s.content.includes('denied by user'))).toBe(true);
  });

  it('in auto mode, rejection continues the conversation', async () => {
    const agent = new Agent();
    agent.setPermissionMode('auto');
    
    const permissionService = agent.getPermissionService();
    vi.spyOn(permissionService, 'check').mockResolvedValue({ 
      allowed: false, 
      reason: 'too risky' 
    });

    const stream1 = new MockStream();
    const stream2 = new MockStream();

    let callCount = 0;
    mockChatStream.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return stream1;
      if (callCount === 2) {
        // Delay emission so agent can set up listeners
        setImmediate(() => {
          stream2.emit('text', 'I cannot do that because it is too risky.');
          stream2.emit('contentBlock', { type: 'text', text: 'I cannot do that because it is too risky.' });
          stream2.resolveFinal({ usage: { input_tokens: 5, output_tokens: 10 }, stop_reason: 'end_turn' });
        });
        return stream2;
      }
      return new MockStream();
    });

    const runPromise = agent.run('do something risky');

    // 1st turn: assistant calls tool
    stream1.emit('contentBlock', { type: 'tool_use', id: 'call_1', name: 'testTool', input: {} });
    stream1.resolveFinal({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'tool_use' });

    await runPromise;

    const turns = agent.getStore().getTurns();
    // turns: [user msg, assistant tool_use, user tool_result (denied), assistant response]
    expect(turns).toHaveLength(4);
    const toolResultTurn = turns[2];
    expect((toolResultTurn.content as any)[0].content).toContain('Tool execution denied by auto-gate: too risky');
    
    const finalTurn = turns[3];
    expect(finalTurn.role).toBe('assistant');
  });
});
