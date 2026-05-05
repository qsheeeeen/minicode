import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRun = vi.fn();
const mockSetDisplay = vi.fn();
const mockOnChange = vi.fn();
const mockGetTurns = vi.fn().mockReturnValue([]);
const mockGetStatuses = vi.fn().mockReturnValue([]);

const mockAgent = {
  run: mockRun,
  setDisplay: mockSetDisplay,
  getStore: vi.fn().mockReturnValue({
    onChange: mockOnChange,
    getTurns: mockGetTurns,
    getStatuses: mockGetStatuses,
    toLLMMessages: vi.fn().mockReturnValue([]),
  }),
  getToolRegistry: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
  setTokenCount: vi.fn(),
  setSession: vi.fn(),
  setMessages: vi.fn(),
};

import { runHeadless } from './headless.js';

describe('runHeadless', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sets headless display on agent', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(mockAgent as any, 'test prompt');
    expect(mockSetDisplay).toHaveBeenCalled();
    const displayArg = mockSetDisplay.mock.calls[0][0];
    expect(displayArg).toBeDefined();
    expect(typeof displayArg.confirm).toBe('function');
  });

  it('headless display confirm always returns false', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    let capturedConfirm: Function = () => true;
    mockSetDisplay.mockImplementationOnce((d: any) => { capturedConfirm = d.confirm; });
    await runHeadless(mockAgent as any, 'test prompt');
    const result = await capturedConfirm({ title: 'test', message: 'msg' });
    expect(result).toBe(false);
  });

  it('calls agent.run with initial prompt', async () => {
    mockRun.mockResolvedValueOnce(undefined);
    await runHeadless(mockAgent as any, 'test prompt');
    expect(mockRun).toHaveBeenCalledWith('test prompt');
  });

  it('handles Aborted error', async () => {
    mockRun.mockRejectedValueOnce(new Error('Aborted'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runHeadless(mockAgent as any, 'test prompt');
    expect(logSpy).toHaveBeenCalledWith('(Aborted)');
    logSpy.mockRestore();
  });

  it('handles generic error', async () => {
    mockRun.mockRejectedValueOnce(new Error('test error'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runHeadless(mockAgent as any, 'test prompt');
    expect(errSpy).toHaveBeenCalledWith('(Error: test error)');
    errSpy.mockRestore();
  });

  it('throws non-Error objects', async () => {
    mockRun.mockRejectedValueOnce('string error');
    await expect(runHeadless(mockAgent as any, 'test prompt')).rejects.toBe('string error');
  });
});
