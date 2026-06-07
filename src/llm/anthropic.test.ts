import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi
  .fn()
  .mockResolvedValue({
    id: "msg_1",
    role: "assistant",
    content: [],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
const mockStream = vi.fn().mockReturnValue({});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        messages: {
          create: mockCreate,
          stream: mockStream,
        },
      };
    }),
  };
});

import { AnthropicClient } from "./anthropic.js";

describe("AnthropicClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("chatStream", () => {
    it("sends correct parameters to client.messages.stream", async () => {
      const client = new AnthropicClient("test-key");
      client.chatStream([{ role: "user", content: "hello" }], [], {
        model: "custom-model",
        maxTokens: 1000,
        system: "test system",
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "custom-model",
          max_tokens: 1000,
          system: "test system",
          messages: [{ role: "user", content: "hello" }],
          tools: [],
          thinking: { type: "adaptive" },
        }),
        expect.objectContaining({
          signal: undefined,
        }),
      );
    });

    it("includes effort in output_config when provided", async () => {
      const client = new AnthropicClient();
      client.chatStream([], [], {
        effort: "xhigh",
      });

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "adaptive" },
          output_config: { effort: "xhigh" },
        }),
        expect.objectContaining({
          signal: undefined,
        }),
      );
    });
  });

  describe("chatStream", () => {
    it("sends correct parameters to client.messages.stream", () => {
      const client = new AnthropicClient();
      client.chatStream([{ role: "user", content: "hi" }], [], {});

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "hi" }],
          thinking: { type: "adaptive" },
        }),
        expect.objectContaining({
          signal: undefined,
        }),
      );
    });
  });
});
