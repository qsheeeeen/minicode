import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeTool } from './write.js';

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('writeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('writes content to file', async () => {
      const fs = await import('fs/promises');
      const result = await writeTool.execute({ path: 'test.txt', content: 'hello world' });
      expect(result.output).toBe('Wrote test.txt');
      expect(fs.default.writeFile).toHaveBeenCalledWith('test.txt', 'hello world', 'utf-8');
    });

    it('creates parent directories', async () => {
      const fs = await import('fs/promises');
      await writeTool.execute({ path: 'dir/file.txt', content: 'content' });
      expect(fs.default.mkdir).toHaveBeenCalled();
    });

    it('returns error on failure', async () => {
      const fs = await import('fs/promises');
      (fs.default.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('EACCES'));
      const result = await writeTool.execute({ path: '/root/file.txt', content: 'hello' });
      expect(result.output).toContain('EACCES');
    });
  });

  describe('format', () => {
    it('formats with line count', () => {
      const formatted = writeTool.formatCall({ path: 'test.txt', content: 'line1\nline2\nline3' });
      expect(formatted.props.children).toContain('3 lines');
    });

    it('formats single line', () => {
      const formatted = writeTool.formatCall({ path: 'test.txt', content: 'single line' });
      expect(formatted.props.children).toContain('1 lines');
    });
  });
});
