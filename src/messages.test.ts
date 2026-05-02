import { describe, it, expect, vi } from 'vitest';
import { MessageStore, toDisplayMessages, type StatusMessage } from './messages.js';
import type { MessageParam } from './llm/anthropic.js';

describe('toDisplayMessages', () => {

  it('renders user string turns', () => {
    const turns: MessageParam[] = [{ role: 'user', content: 'hello' }];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('hello');
  });

  it('renders text blocks', () => {
    const turns: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('text');
    expect(result[0].content).toBe('hi there');
  });

  it('attaches tool_result content to matching tool_use', () => {
    const turns: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents' }] },
    ];
    const result = toDisplayMessages(turns, []);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('file contents');
  });

  it('interleaves statuses with turns based on turnIndex', () => {
    const turns: MessageParam[] = [{ role: 'user', content: 'hello' }];
    const statuses: StatusMessage[] = [
      { role: 'status', content: 'done', timestamp: new Date(), turnIndex: 1 },
    ];
    const result = toDisplayMessages(turns, statuses);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('status');
  });

  it('places turnIndex 0 statuses before all turns', () => {
    const turns: MessageParam[] = [{ role: 'user', content: 'hello' }];
    const statuses: StatusMessage[] = [
      { role: 'status', content: 'cleared', timestamp: new Date(), turnIndex: 0 },
    ];
    const result = toDisplayMessages(turns, statuses);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('status');
    expect(result[1].role).toBe('user');
  });
});

describe('MessageStore', () => {
  it('setTurns replaces turns', () => {
    const store = new MessageStore();
    store.setTurns([{ role: 'user', content: 'hello' }]);
    expect(store.getTurns()).toHaveLength(1);
  });

  it('addUserMessage appends user turn', () => {
    const store = new MessageStore();
    store.addUserMessage('hello');
    expect(store.getTurns()[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('toLLMMessages returns turns directly', () => {
    const store = new MessageStore();
    store.addUserMessage('hello');
    expect(store.toLLMMessages()).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('notifies onChange on setTurns', () => {
    const store = new MessageStore();
    const cb = vi.fn();
    store.onChange(cb);
    store.setTurns([{ role: 'user', content: 'hello' }]);
    expect(cb).toHaveBeenCalled();
  });

  it('clear removes all turns and statuses', () => {
    const store = new MessageStore();
    store.addUserMessage('hello');
    store.addStatus({ role: 'status', content: 'done', timestamp: new Date() });
    store.clear();
    expect(store.getTurns()).toEqual([]);
    expect(store.getStatuses()).toEqual([]);
  });

  it('streaming state toggles and notifies', () => {
    const store = new MessageStore();
    const cb = vi.fn();
    store.onChange(cb);
    store.setStreaming(true);
    expect(store.isStreaming()).toBe(true);
    expect(cb).toHaveBeenCalled();
  });
});
