import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTool } from './read.js';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe('readTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('reads file content', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('file content');
      const result = await readTool.execute({ path: 'test.txt' });
      expect(result.output).toBe('file content');
      expect(fs.default.readFile).toHaveBeenCalledWith('test.txt', 'utf-8');
    });

    it('returns error when file not found', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT: no such file'));
      const result = await readTool.execute({ path: 'nonexistent.txt' });
      expect(result.output).toContain('ENOENT');
    });

    it('slices lines with offset and limit', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('line1\nline2\nline3\nline4\nline5');
      const result = await readTool.execute({ path: 'test.txt', offset: 2, limit: 2 });
      expect(result.output).toBe('line2\nline3');
    });

    it('uses 1-indexed offset', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('line1\nline2\nline3');
      const result = await readTool.execute({ path: 'test.txt', offset: 1 });
      expect(result.output).toBe('line1\nline2\nline3');
    });

    it('handles offset without limit', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('line1\nline2\nline3\nline4');
      const result = await readTool.execute({ path: 'test.txt', offset: 3 });
      expect(result.output).toBe('line3\nline4');
    });

    it('handles limit only (no offset)', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('line1\nline2\nline3\nline4\nline5');
      const result = await readTool.execute({ path: 'test.txt', limit: 2 });
      expect(result.output).toBe('line1\nline2');
    });
  });

});
