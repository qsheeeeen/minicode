import { describe, it, expect } from 'vitest';
import { MessageRole, DisplayMessage } from './session-display.js';

describe('session-display types', () => {
  it('exports MessageRole type', () => {
    const role: MessageRole = 'user';
    expect(role).toBe('user');
  });

  it('exports DisplayMessage interface', () => {
    const msg: DisplayMessage = { role: 'assistant', content: 'hello' };
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('hello');
  });
});
