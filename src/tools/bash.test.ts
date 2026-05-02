import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bashTool } from './bash.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('bashTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('returns stdout on success', async () => {
      const { spawn } = await import('child_process');
      const mockProc = {
        stdout: { on: vi.fn((evt, cb) => evt === 'data' && cb(Buffer.from('output'))) },
        stderr: { on: vi.fn() },
        on: vi.fn((evt, cb) => evt === 'close' && cb(0)),
        kill: vi.fn(),
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

      const result = await bashTool.execute({ command: 'echo hello' });
      expect(result.output).toBe('output');
    });

    it('throws error on non-zero exit', async () => {
      const { spawn } = await import('child_process');
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn((evt, cb) => evt === 'data' && cb(Buffer.from('error'))) },
        on: vi.fn((evt, cb) => evt === 'close' && cb(1)),
        kill: vi.fn(),
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

      const result = await bashTool.execute({ command: 'exit 1' });
      expect(result.output).toContain('Exit code 1');
    });

    it('returns error when command not found', async () => {
      const { spawn } = await import('child_process');
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn((evt, cb) => evt === 'data' && cb(Buffer.from('command not found'))) },
        on: vi.fn((evt, cb) => evt === 'close' && cb(127)),
        kill: vi.fn(),
      };
      (spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProc as any);

      const result = await bashTool.execute({ command: 'nonexistent_cmd' });
      expect(result.output).toContain('127');
    });
  });

});
