import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

const mockRun = vi.fn();
const mockSetDisplay = vi.fn();
const mockOnChange = vi.fn();
const mockGetAll = vi.fn().mockReturnValue([]);

vi.mock('../utils/react.js', () => ({
  elementToText: vi.fn().mockReturnValue('tool line 1\ntool line 2'),
}));

const mockAgent = {
  run: mockRun,
  setDisplay: mockSetDisplay,
  getStore: vi.fn().mockReturnValue({
    onChange: mockOnChange,
    getAll: mockGetAll,
  }),
};

import { runHeadless } from './headless.js';

describe('runHeadless', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets headless display on agent', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    
    await runHeadless(mockAgent as any, 'test prompt');
    
    expect(mockSetDisplay).toHaveBeenCalled();
    const displayArg = mockSetDisplay.mock.calls[0][0];
    
    expect(displayArg).toBeDefined();
    expect(typeof displayArg.status).toBe('function');
    expect(typeof displayArg.error).toBe('function');
    expect(typeof displayArg.updateTokenCount).toBe('function');
    expect(typeof displayArg.confirm).toBe('function');
  });

  it('headless display confirm always returns false', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    
    await runHeadless(mockAgent as any, 'test prompt');
    
    const displayArg = mockSetDisplay.mock.calls[0][0];
    const originalConsoleLog = console.log;
    console.log = vi.fn();
    
    const confirmResult = await displayArg.confirm({ message: 'test' });
    expect(confirmResult).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Permission denied: test'));
    
    console.log = originalConsoleLog;
  });

  it('calls agent.run with initial prompt', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    
    await runHeadless(mockAgent as any, 'hello headless');
    
    expect(mockRun).toHaveBeenCalledWith('hello headless');
  });

  it('handles Aborted error from agent.run', async () => {
    const originalConsoleLog = console.log;
    console.log = vi.fn();
    
    mockRun.mockRejectedValueOnce(new Error('Aborted'));
    
    await runHeadless(mockAgent as any, 'hello');
    
    expect(console.log).toHaveBeenCalledWith('(Aborted)');
    
    console.log = originalConsoleLog;
  });

  it('handles generic error from agent.run', async () => {
    const originalConsoleError = console.error;
    console.error = vi.fn();
    
    mockRun.mockRejectedValueOnce(new Error('Test error'));
    
    await runHeadless(mockAgent as any, 'hello');
    
    expect(console.error).toHaveBeenCalledWith('(Error: Test error)');
    
    console.error = originalConsoleError;
  });

  it('throws non-Error objects from agent.run', async () => {
    mockRun.mockRejectedValueOnce('String error');
    
    await expect(runHeadless(mockAgent as any, 'hello')).rejects.toBe('String error');
  });

  describe('onChange callback', () => {
    let onChangeCb: () => void;
    let originalStdoutWrite: typeof process.stdout.write;
    let originalConsoleLog: typeof console.log;
    let originalConsoleError: typeof console.error;

    beforeEach(async () => {
      originalStdoutWrite = process.stdout.write;
      originalConsoleLog = console.log;
      originalConsoleError = console.error;

      process.stdout.write = vi.fn() as any;
      console.log = vi.fn();
      console.error = vi.fn();

      mockRun.mockResolvedValueOnce(undefined);
      await runHeadless(mockAgent as any, 'test');
      
      onChangeCb = mockOnChange.mock.calls[0][0];
    });

    afterEach(() => {
      process.stdout.write = originalStdoutWrite;
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    });

    it('prints user, status, and error messages', () => {
      mockGetAll.mockReturnValue([
        { role: 'user', content: 'hello user' },
        { role: 'status', content: 'system status' },
        { role: 'error', content: 'system error' },
      ]);
      onChangeCb();

      expect(process.stdout.write).toHaveBeenCalledWith('[user] hello user\n\n');
      expect(console.log).toHaveBeenCalledWith('[status] system status');
      expect(console.error).toHaveBeenCalledWith('[error] system error');
    });

    it('prints tool_use elements', () => {
      mockGetAll.mockReturnValue([
        { id: 'msg1', role: 'tool_use', element: { type: 'div', props: { children: 'tool line 1\ntool line 2' } } }
      ]);
      onChangeCb();

      expect(process.stdout.write).toHaveBeenCalledWith('\n[tool] ');
      expect(console.log).toHaveBeenCalledWith('tool line 1');
      expect(console.log).toHaveBeenCalledWith('       tool line 2');
    });

    it('streams assistant text and finalizes it', () => {
      // First update: partial text
      mockGetAll.mockReturnValue([
        { id: 'msg2', role: 'assistant', content: 'part1', isStreaming: true }
      ]);
      onChangeCb();
      expect(process.stdout.write).toHaveBeenCalledWith('\n[assistant] ');
      expect(process.stdout.write).toHaveBeenCalledWith('part1');

      // Second update: more text
      mockGetAll.mockReturnValue([
        { id: 'msg2', role: 'assistant', content: 'part1 part2', isStreaming: true }
      ]);
      onChangeCb();
      expect(process.stdout.write).toHaveBeenCalledWith(' part2');

      // Third update: finalized
      mockGetAll.mockReturnValue([
        { id: 'msg2', role: 'assistant', content: 'part1 part2', isStreaming: false }
      ]);
      onChangeCb();
      expect(process.stdout.write).toHaveBeenCalledWith('\n');
    });

    it('prints finalized thinking content', () => {
      mockGetAll.mockReturnValue([
        { id: 'msg3', role: 'thinking', content: 'my thoughts', isStreaming: false }
      ]);
      onChangeCb();

      expect(console.log).toHaveBeenCalledWith('\n[thinking] my thoughts');
    });
  });
});
