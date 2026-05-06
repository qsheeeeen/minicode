import { describe, it, expect, vi } from 'vitest';
import { RecordDisplay, CallbackDisplay, ConsoleDisplay } from './display.js';

describe('RecordDisplay', () => {
  it('records status events', () => {
    const display = new RecordDisplay();
    display.status('test message');
    expect(display.events).toHaveLength(1);
    expect(display.events[0].type).toBe('status');
    expect(display.events[0].data).toBe('test message');
  });

  it('records error events', () => {
    const display = new RecordDisplay();
    display.error('error message');
    expect(display.events).toHaveLength(1);
    expect(display.events[0].type).toBe('error');
    expect(display.events[0].data).toBe('error message');
  });

  it('records updateTokenCount events', () => {
    const display = new RecordDisplay();
    display.updateTokenCount(1000);
    expect(display.events).toHaveLength(1);
    expect(display.events[0].type).toBe('tokenCount');
    expect(display.events[0].data).toBe(1000);
  });

  it('records multiple events in order', () => {
    const display = new RecordDisplay();
    display.status('first');
    display.updateTokenCount(100);
    display.error('second');
    expect(display.events).toHaveLength(3);
    expect(display.events[0].data).toBe('first');
    expect(display.events[1].data).toBe(100);
    expect(display.events[2].data).toBe('second');
  });

  it('includes timestamp on events', () => {
    const display = new RecordDisplay();
    display.status('test');
    expect(display.events[0].timestamp).toBeInstanceOf(Date);
  });
});

describe('CallbackDisplay', () => {
  it('calls onMessage for status', () => {
    const onMessage = vi.fn();
    const display = new CallbackDisplay({ onMessage });
    display.status('test status');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'status',
      content: 'test status',
    }));
  });

  it('calls onMessage for error', () => {
    const onMessage = vi.fn();
    const display = new CallbackDisplay({ onMessage });
    display.error('test error');
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'error',
      content: 'test error',
    }));
  });

  it('calls onTokenUpdate for updateTokenCount', () => {
    const onTokenUpdate = vi.fn();
    const display = new CallbackDisplay({ onTokenUpdate });
    display.updateTokenCount(5000);
    expect(onTokenUpdate).toHaveBeenCalledWith(5000);
  });

  it('calls onPrompt when prompt is called', async () => {
    const onPrompt = vi.fn().mockResolvedValue('yes');
    const display = new CallbackDisplay({ onPrompt });
    const result = await display.prompt({ message: 'Test?', options: [{ label: 'Yes', value: 'yes' }] });
    expect(result).toBe('yes');
    expect(onPrompt).toHaveBeenCalledWith({ message: 'Test?', options: [{ label: 'Yes', value: 'yes' }] });
  });

  it('prompt returns empty string when onPrompt is undefined', async () => {
    const display = new CallbackDisplay({});
    const result = await display.prompt({ message: 'Test?', options: [{ label: 'Yes', value: 'yes' }] });
    expect(result).toBe('');
  });
});

describe('ConsoleDisplay', () => {
  it('implements DisplayAdapter interface', () => {
    const display = new ConsoleDisplay();
    expect(typeof display.status).toBe('function');
    expect(typeof display.error).toBe('function');
    expect(typeof display.updateTokenCount).toBe('function');
  });
});
