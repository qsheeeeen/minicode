import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readPromptFile, loadGlobalPrompt, loadProjectPrompt } from './prompts.js';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe('readPromptFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trimmed content on success', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('  hello world  \n');
    const result = await readPromptFile('prompt.md');
    expect(result).toBe('hello world');
  });

  it('returns empty string on error', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
    const result = await readPromptFile('nonexistent.md');
    expect(result).toBe('');
  });
});

describe('loadGlobalPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads from ~/.minicode/MINICODE.md', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('global prompt content');
    await loadGlobalPrompt();
    const readCall = (fs.default.readFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(readCall).toContain('.minicode');
    expect(readCall).toContain('MINICODE.md');
  });
});

describe('loadProjectPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads from project directory', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('project prompt');
    await loadProjectPrompt('/my/project');
    const readCall = (fs.default.readFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(readCall).toBe('/my/project/MINICODE.md');
  });

  it('uses custom prompt filename', async () => {
    const fs = await import('fs/promises');
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('custom prompt');
    await loadProjectPrompt('/my/project', 'CUSTOM.md');
    const readCall = (fs.default.readFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(readCall).toBe('/my/project/CUSTOM.md');
  });
});
