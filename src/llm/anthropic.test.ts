import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({ id: 'msg_1', role: 'assistant', content: [] });
const mockStream = vi.fn().mockReturnValue({});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(function() {
      return {
        messages: {
          create: mockCreate,
          stream: mockStream,
        }
      };
    }),
  };
});

import { AnthropicClient } from './anthropic.js';

describe('AnthropicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('chat', () => {
    it('sends correct parameters to client.messages.create', async () => {
      const client = new AnthropicClient('test-key');
      await client.chat([{ role: 'user', content: 'hello' }], [], {
        model: 'custom-model',
        maxTokens: 1000,
        system: 'test system',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
          max_tokens: 1000,
          system: 'test system',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [],
        })
      );
    });

    it('adds thinking block when thinking is enabled', async () => {
      const client = new AnthropicClient();
      await client.chat([], [], {
        thinking: true,
        thinkingTokens: 15000,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 15000,
          },
        })
      );
    });
  });

  describe('chatStream', () => {
    it('sends correct parameters to client.messages.stream', () => {
      const client = new AnthropicClient();
      client.chatStream([{ role: 'user', content: 'hi' }], [], {
        thinking: true,
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'hi' }],
          thinking: {
            type: 'enabled',
            budget_tokens: 20000, // default
          },
        })
      );
    });
  });
});
