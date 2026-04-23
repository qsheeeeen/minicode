import { describe, it, expect, vi } from 'vitest';
import { MessageStore, toLLMMessages, toDisplayMessages, type AgentMessage } from './messages.js';

describe('toLLMMessages', () => {
  it('passes through plain user messages', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: new Date(), inContext: true },
    ];
    const result = toLLMMessages(messages);
    expect(result).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('groups assistant text with following tool_calls', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'assistant', content: 'thinking...', timestamp: new Date(), inContext: true },
      { id: '2', role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: 'tool-1', toolName: 'read', toolInput: { path: 'a.txt' } },
    ];
    const result = toLLMMessages(messages);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'a.txt' } },
        ],
      },
    ]);
  });

  it('handles tool_call without preceding assistant text', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: 'tool-1', toolName: 'bash', toolInput: { command: 'ls' } },
    ];
    const result = toLLMMessages(messages);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'ls' } },
        ],
      },
    ]);
  });

  it('groups consecutive tool_results into single user turn', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'assistant', content: '', timestamp: new Date(), inContext: true },
      { id: '2', role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: 'tool-1', toolName: 'read', toolInput: {} },
      { id: '3', role: 'tool_result', content: 'file contents', timestamp: new Date(), inContext: true, toolUseId: 'tool-1' },
      { id: '4', role: 'tool_result', content: 'more output', timestamp: new Date(), inContext: true, toolUseId: 'tool-2' },
    ];
    const result = toLLMMessages(messages);
    expect(result).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'read', input: {} }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' },
          { type: 'tool_result', tool_use_id: 'tool-2', content: 'more output' },
        ],
      },
    ]);
  });

  it('filters out messages with inContext=false', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: new Date(), inContext: true },
      { id: '2', role: 'assistant', content: 'hidden', timestamp: new Date(), inContext: false },
    ];
    const result = toLLMMessages(messages);
    expect(result).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('toDisplayMessages', () => {
  it('maps tool_call to tool role', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: 'tool-1', toolName: 'read' },
    ];
    const result = toDisplayMessages(messages);
    expect(result[0].role).toBe('tool');
  });

  it('maps status role correctly', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'status', content: 'thinking...', timestamp: new Date(), inContext: true },
    ];
    const result = toDisplayMessages(messages);
    expect(result[0].role).toBe('status');
  });

  it('includes slotId for tool_call messages', () => {
    const messages: AgentMessage[] = [
      { id: 'my-id', role: 'tool_call', content: '', timestamp: new Date(), inContext: true, toolUseId: 'tool-1', toolName: 'read' },
    ];
    const result = toDisplayMessages(messages);
    expect(result[0].slotId).toBe('my-id');
  });

  it('passes through isStreaming flag', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'assistant', content: 'streaming', timestamp: new Date(), inContext: true, isStreaming: true },
    ];
    const result = toDisplayMessages(messages);
    expect(result[0].isStreaming).toBe(true);
  });
});

describe('MessageStore', () => {
  describe('add', () => {
    it('adds message with generated id', () => {
      const store = new MessageStore();
      const msg = store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      expect(msg.id).toBe('msg-0');
    });

    it('increments id for each add', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'a', timestamp: new Date(), inContext: true });
      const msg = store.add({ role: 'user', content: 'b', timestamp: new Date(), inContext: true });
      expect(msg.id).toBe('msg-1');
    });
  });

  describe('get', () => {
    it('returns message by id', () => {
      const store = new MessageStore();
      const added = store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      const found = store.get(added.id);
      expect(found?.content).toBe('test');
    });

    it('returns undefined for unknown id', () => {
      const store = new MessageStore();
      expect(store.get('unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all messages', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'a', timestamp: new Date(), inContext: true });
      store.add({ role: 'user', content: 'b', timestamp: new Date(), inContext: true });
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe('getInContext', () => {
    it('filters to inContext messages only', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'in', timestamp: new Date(), inContext: true });
      store.add({ role: 'user', content: 'out', timestamp: new Date(), inContext: false });
      expect(store.getInContext()).toHaveLength(1);
      expect(store.getInContext()[0].content).toBe('in');
    });
  });

  describe('update', () => {
    it('updates existing message', () => {
      const store = new MessageStore();
      const msg = store.add({ role: 'user', content: 'original', timestamp: new Date(), inContext: true });
      store.update(msg.id, { content: 'updated' });
      expect(store.get(msg.id)?.content).toBe('updated');
    });

    it('does nothing for unknown id', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      store.update('unknown', { content: 'updated' });
      expect(store.getAll()[0].content).toBe('test');
    });
  });

  describe('clear', () => {
    it('removes all messages and resets id counter', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'a', timestamp: new Date(), inContext: true });
      store.add({ role: 'user', content: 'b', timestamp: new Date(), inContext: true });
      store.clear();
      expect(store.getAll()).toHaveLength(0);
      const msg = store.add({ role: 'user', content: 'c', timestamp: new Date(), inContext: true });
      expect(msg.id).toBe('msg-0');
    });
  });

  describe('replace', () => {
    it('replaces all messages', () => {
      const store = new MessageStore();
      store.add({ role: 'user', content: 'a', timestamp: new Date(), inContext: true });
      const newMessages: AgentMessage[] = [
        { id: 'x', role: 'user', content: 'b', timestamp: new Date(), inContext: true },
      ];
      store.replace(newMessages);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].content).toBe('b');
    });
  });

  describe('onChange callback', () => {
    it('notifies on add', () => {
      const store = new MessageStore();
      const cb = vi.fn();
      store.onChange(cb);
      store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('notifies on update', () => {
      const store = new MessageStore();
      const cb = vi.fn();
      store.onChange(cb);
      const msg = store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      store.update(msg.id, { content: 'updated' });
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('notifies on clear', () => {
      const store = new MessageStore();
      const cb = vi.fn();
      store.onChange(cb);
      store.add({ role: 'user', content: 'test', timestamp: new Date(), inContext: true });
      store.clear();
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('notifies on replace', () => {
      const store = new MessageStore();
      const cb = vi.fn();
      store.onChange(cb);
      store.replace([]);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});

describe('MessageStore.fromMessageParams', () => {
  it('restores user string message', () => {
    const params = [{ role: 'user' as const, content: 'hello' }];
    const store = MessageStore.fromMessageParams(params);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].role).toBe('user');
    expect(store.getAll()[0].content).toBe('hello');
  });

  it('restores assistant text message', () => {
    const params = [{ role: 'assistant' as const, content: 'hi' }];
    const store = MessageStore.fromMessageParams(params);
    expect(store.getAll()[0].role).toBe('assistant');
    expect(store.getAll()[0].content).toBe('hi');
  });

  it('restores tool_use blocks as separate messages', () => {
    const params = [{
      role: 'assistant' as const,
      content: [
        { type: 'text' as const, text: 'using tool' },
        { type: 'tool_use' as const, id: 't1', name: 'bash', input: { cmd: 'ls' } },
      ],
    }];
    const store = MessageStore.fromMessageParams(params);
    const msgs = store.getAll();
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[1].role).toBe('tool_call');
    expect(msgs[1].toolUseId).toBe('t1');
    expect(msgs[1].toolName).toBe('bash');
  });

  it('restores tool_result blocks from user messages', () => {
    const params = [{
      role: 'user' as const,
      content: [
        { type: 'tool_result' as const, tool_use_id: 't1', content: 'output' },
      ],
    }];
    const store = MessageStore.fromMessageParams(params);
    expect(store.getAll()[0].role).toBe('tool_result');
    expect(store.getAll()[0].content).toBe('output');
    expect(store.getAll()[0].toolUseId).toBe('t1');
  });

  it('handles non-string tool_result content', () => {
    const params = [{
      role: 'user' as const,
      content: [
        { type: 'tool_result' as const, tool_use_id: 't1', content: { json: true } },
      ],
    }];
    const store = MessageStore.fromMessageParams(params);
    expect(store.getAll()[0].content).toBe('{"json":true}');
  });
});
