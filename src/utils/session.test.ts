import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, type SessionData } from './session.js';

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue('{}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('process/cwd', () => ({
  cwd: vi.fn().mockReturnValue('/test/project'),
}));

describe('SessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeProjectHash', () => {
    it('computes consistent hash for same cwd', () => {
      const manager1 = new SessionManager();
      const manager2 = new SessionManager();
      expect(manager1.getProjectHash()).toBe(manager2.getProjectHash());
    });

    it('returns 12 character hex string', () => {
      const manager = new SessionManager();
      const hash = manager.getProjectHash();
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });
  });

  describe('getSessionDir', () => {
    it('returns path in sessions directory', () => {
      const manager = new SessionManager();
      const dir = manager.getSessionDir();
      expect(dir).toContain('.minicode/sessions/');
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions', async () => {
      const fs = await import('fs/promises');
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const manager = new SessionManager();
      const sessions = await manager.list();
      expect(sessions).toEqual([]);
    });

    it('returns sessions sorted by updatedAt descending', async () => {
      const fs = await import('fs/promises');
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['session1.json', 'session2.json']);
      (fs.default.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(JSON.stringify({ updatedAt: '2024-01-01T10:00:00Z' }))
        .mockResolvedValueOnce(JSON.stringify({ updatedAt: '2024-01-02T10:00:00Z' }));
      const manager = new SessionManager();
      const sessions = await manager.list();
      // Sorted descending by updatedAt (later dates first)
      expect(sessions[0].name).toBe('session2');
      expect(sessions[1].name).toBe('session1');
    });
  });

  describe('listNames', () => {
    it('returns session names without .json extension', async () => {
      const fs = await import('fs/promises');
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(['a.json', 'b.json', 'c.txt']);
      const manager = new SessionManager();
      const names = await manager.listNames();
      expect(names).toEqual(['a', 'b']);
    });
  });

  describe('getMostRecent', () => {
    it('returns null when no sessions', async () => {
      const fs = await import('fs/promises');
      (fs.default.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const manager = new SessionManager();
      const recent = await manager.getMostRecent();
      expect(recent).toBeNull();
    });
  });

  describe('get', () => {
    it('returns parsed session data', async () => {
      const fs = await import('fs/promises');
      const sessionData: SessionData = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }],
        totalTokens: 1000,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sessionData));
      const manager = new SessionManager();
      const data = await manager.get('test-session');
      expect(data?.model).toBe('claude-3');
      expect(data?.messages).toHaveLength(1);
    });

    it('returns null when file not found', async () => {
      const fs = await import('fs/promises');
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
      const manager = new SessionManager();
      const data = await manager.get('nonexistent');
      expect(data).toBeNull();
    });
  });

  describe('save', () => {
    it('writes session data with timestamps', async () => {
      const fs = await import('fs/promises');
      const data: SessionData = {
        model: 'claude-3',
        messages: [],
        totalTokens: 0,
        createdAt: '',
        updatedAt: '',
      };
      const manager = new SessionManager();
      await manager.save('test', data);
      expect(fs.default.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.json'),
        expect.any(String)
      );
      // Check that updatedAt was set
      const writtenData = JSON.parse((fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(writtenData.updatedAt).toBeTruthy();
    });

    it('sets createdAt on first save', async () => {
      const fs = await import('fs/promises');
      const data: SessionData = {
        model: 'claude-3',
        messages: [],
        totalTokens: 0,
        createdAt: '',
        updatedAt: '',
      };
      const manager = new SessionManager();
      await manager.save('test', data);
      const writtenData = JSON.parse((fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1]);
      expect(writtenData.createdAt).toBeTruthy();
    });
  });

  describe('delete', () => {
    it('calls unlink with correct path', async () => {
      const fs = await import('fs/promises');
      const manager = new SessionManager();
      await manager.delete('test-session');
      expect(fs.default.unlink).toHaveBeenCalledWith(
        expect.stringContaining('test-session.json')
      );
    });
  });

  describe('rename', () => {
    it('calls rename with correct paths', async () => {
      const fs = await import('fs/promises');
      const manager = new SessionManager();
      await manager.rename('old-name', 'new-name');
      expect(fs.default.rename).toHaveBeenCalledWith(
        expect.stringContaining('old-name.json'),
        expect.stringContaining('new-name.json')
      );
    });
  });
});
