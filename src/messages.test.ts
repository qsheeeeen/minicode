import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { MessageStore, toDisplayMessages, type StatusMessage } from './messages.js';
import type { MessageParam } from './llm/anthropic.js';
import { ToolRegistry } from './tools/registry.js';

function makeToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'Read',
    description: 'Read file',
    input_schema: {},
    execute: vi.fn() as any,
    formatCall: vi.fn().mockReturnValue(React.createElement('div', {}, 'Read /a.txt')),
    formatResult: vi.fn().mockReturnValue(React.createElement('div', {}, 'Result')),
  });
  return registry;
}

describe('toDisplayMessages', () => {
  const toolRegistry = makeToolRegistry();

  it('renders user string turns', () => {
    const turns: MessageParam[] = [{ role: 'user', content: 'hello' }];
    const result = toDisplayMessages(turns, [], toolRegistry);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('hello');
  });

  it('renders assistant text blocks', () => {
    const turns: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ];
    const result = toDisplayMessages(turns, [], toolRegistry);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('hi there');
  });

  it('attaches tool_result to matching tool_use element', () => {
    const turns: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents' }] },
    ];
    const result = toDisplayMessages(turns, [], toolRegistry);
    expect(result).toHaveLength(1);
    expect(result[0].element).toBeDefined();
    expect(toolRegistry.get('Read')?.formatResult).toHaveBeenCalled();
  });

  it('appends status messages at the end', () => {
    const turns: MessageParam[] = [{ role: 'user', content: 'hello' }];
    const statuses: StatusMessage[] = [
      { role: 'status', content: 'done', timestamp: new Date() },
    ];
    const result = toDisplayMessages(turns, statuses, toolRegistry);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('status');
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
