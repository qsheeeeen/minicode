import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionDisplayImpl } from './session-display.js';
import { SessionManager, SessionData } from './session.js';
import { ToolRegistry } from '../tools/registry.js';
import React from 'react';

describe('SessionDisplayImpl', () => {
  let sessionManagerMock: Partial<SessionManager>;
  let toolRegistryMock: Partial<ToolRegistry>;
  let display: SessionDisplayImpl;

  beforeEach(() => {
    sessionManagerMock = {
      get: vi.fn(),
    };
    toolRegistryMock = {
      get: vi.fn(),
    };
    display = new SessionDisplayImpl(
      sessionManagerMock as SessionManager,
      toolRegistryMock as ToolRegistry
    );
  });

  describe('loadForTUI', () => {
    it('returns empty array when session data is null', async () => {
      (sessionManagerMock.get as any).mockResolvedValue(null);
      const result = await display.loadForTUI('nonexistent');
      expect(result).toEqual([]);
    });

    it('parses user string messages', async () => {
      const data: SessionData = {
        model: 'test',
        totalTokens: 10,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01T12:00:00Z',
        messages: [{ role: 'user', content: 'hello world' }],
      };
      (sessionManagerMock.get as any).mockResolvedValue(data);

      const result = await display.loadForTUI('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('hello world');
      expect(result[0].timestamp).toEqual(new Date('2024-01-01T12:00:00Z'));
    });

    it('parses user tool_result blocks', async () => {
      const data: SessionData = {
        model: 'test',
        totalTokens: 10,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01T12:00:00Z',
        messages: [{
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'tool output' },
            { type: 'tool_result', tool_use_id: 'tool-2', content: { json: true } }
          ],
        }],
      };
      (sessionManagerMock.get as any).mockResolvedValue(data);

      const result = await display.loadForTUI('session-1');
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('tool_result');
      expect(result[0].content).toBe('tool output');
      expect(result[1].role).toBe('tool_result');
      expect(result[1].content).toBe('{"json":true}');
    });

    it('parses assistant text blocks', async () => {
      const data: SessionData = {
        model: 'test',
        totalTokens: 10,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01T12:00:00Z',
        messages: [{
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello from assistant' }
          ],
        }],
      };
      (sessionManagerMock.get as any).mockResolvedValue(data);

      const result = await display.loadForTUI('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('hello from assistant');
    });

    it('parses assistant string content', async () => {
      const data: SessionData = {
        model: 'test',
        totalTokens: 10,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01T12:00:00Z',
        messages: [{
          role: 'assistant',
          content: 'hello string',
        }],
      };
      (sessionManagerMock.get as any).mockResolvedValue(data);

      const result = await display.loadForTUI('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('hello string');
    });

    it('parses assistant tool_use blocks', async () => {
      const toolElement = React.createElement('div', {}, 'Formatted Tool Call');
      (toolRegistryMock.get as any).mockReturnValue({
        format: vi.fn().mockReturnValue(toolElement),
      });

      const data: SessionData = {
        model: 'test',
        totalTokens: 10,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01T12:00:00Z',
        messages: [{
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'a.txt' } }
          ],
        }],
      };
      (sessionManagerMock.get as any).mockResolvedValue(data);

      const result = await display.loadForTUI('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool');
      expect(result[0].content).toBe('');
      expect(result[0].element).toBe(toolElement);
    });
  });
});
