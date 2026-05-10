import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionService } from './permission.js';
import type { AnthropicClient } from '../llm/anthropic.js';

describe('PermissionService', () => {
  describe('getMode', () => {
    it('returns initial mode', () => {
      const service = new PermissionService({ initialMode: 'yolo' });
      expect(service.getMode()).toBe('yolo');
    });
  });

  describe('setMode', () => {
    it('sets mode directly', () => {
      const service = new PermissionService({ initialMode: 'manual' });
      service.setMode('auto');
      expect(service.getMode()).toBe('auto');
    });
  });

  describe('cycleMode', () => {
    it('cycles from manual to yolo', () => {
      const service = new PermissionService({ initialMode: 'manual' });
      expect(service.cycleMode()).toBe('yolo');
    });

    it('cycles from yolo to auto', () => {
      const service = new PermissionService({ initialMode: 'yolo' });
      expect(service.cycleMode()).toBe('auto');
    });

    it('cycles from auto to manual', () => {
      const service = new PermissionService({ initialMode: 'auto' });
      expect(service.cycleMode()).toBe('manual');
    });

    it('cycles through all modes', () => {
      const service = new PermissionService({ initialMode: 'manual' });
      expect(service.cycleMode()).toBe('yolo');
      expect(service.cycleMode()).toBe('auto');
      expect(service.cycleMode()).toBe('manual');
    });
  });

  describe('check', () => {
    it('yolo always returns true', async () => {
      const service = new PermissionService({ initialMode: 'yolo' });
      const result = await service.check('Bash', { command: 'rm -rf /' }, 'Dangerous command');
      expect(result).toBe(true);
    });

    it('manual uses prompter.prompt when available', async () => {
      const service = new PermissionService({ initialMode: 'manual' });
      const promptMock = vi.fn().mockResolvedValue('yes');
      service.setPrompter({ prompt: promptMock });
      const result = await service.check('Bash', { command: 'ls' }, 'List files');
      expect(result).toBe(true);
      expect(promptMock).toHaveBeenCalledWith({
        message: expect.stringContaining('List files'),
        options: expect.arrayContaining([{ label: 'Yes', value: 'yes' }]),
      });
    });

    it('manual denies when prompter is undefined (no UI to ask)', async () => {
      const service = new PermissionService({ initialMode: 'manual' });
      const result = await service.check('Bash', { command: 'ls' }, 'List files');
      expect(result).toBe(false);
    });

    it('manual returns false when prompter returns no', async () => {
      const service = new PermissionService({ initialMode: 'manual' });
      const promptMock = vi.fn().mockResolvedValue('no');
      service.setPrompter({ prompt: promptMock });
      const result = await service.check('Bash', { command: 'ls' }, 'List files');
      expect(result).toBe(false);
    });
  });

  describe('autoDecide', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns false when client is not set', async () => {
      const service = new PermissionService({ initialMode: 'auto' });
      const result = await (service as any).autoDecide('Bash', { command: 'ls' });
      expect(result).toBe(false);
    });

    it('returns true for "yes" response', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '  yes  ' }],
      });
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient, model: 'claude-3' });

      const result = await (service as any).autoDecide('Read', { path: 'a.txt' });

      expect(result).toBe(true);
      expect(mockChat).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
        [],
        expect.objectContaining({ model: 'claude-3', maxTokens: 50 })
      );
    });

    it('returns false for "no" response', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'no' }],
      });
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient });

      const result = await (service as any).autoDecide('Bash', { command: 'rm -rf /' });

      expect(result).toBe(false);
    });

    it('returns true when response includes "yes"', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Yes, this is allowed.' }],
      });
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient });

      const result = await (service as any).autoDecide('Bash', { command: 'echo hello' });

      expect(result).toBe(true);
    });

    it('returns false when response does not include "yes"', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'I think not.' }],
      });
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient });

      const result = await (service as any).autoDecide('Bash', { command: 'ls' });

      expect(result).toBe(false);
    });

    it('returns false on chat error', async () => {
      const mockChat = vi.fn().mockRejectedValue(new Error('API error'));
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient });

      const result = await (service as any).autoDecide('Bash', { command: 'ls' });

      expect(result).toBe(false);
    });

    it('returns false when content is empty', async () => {
      const mockChat = vi.fn().mockResolvedValue({ content: [] });
      const mockClient = { chat: mockChat } as unknown as AnthropicClient;
      const service = new PermissionService({ initialMode: 'auto', client: mockClient });

      const result = await (service as any).autoDecide('Bash', { command: 'ls' });

      expect(result).toBe(false);
    });
  });
});
