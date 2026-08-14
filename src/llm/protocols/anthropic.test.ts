import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue({
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
import { Model } from "../model.js";

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
      const s = client.chatStream([{ type: "user", text: "hello" }], [], {
        model: new Model("custom-model", "test-provider", 1000),
        maxTokens: 1000,
        system: "test system",
      });
      await s.next();

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
      const s = client.chatStream([], [], {
        model: new Model("custom-model", "test-provider", 1000, "xhigh"),
      });
      await s.next();

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
    it("sends correct parameters to client.messages.stream", async () => {
      const client = new AnthropicClient();
      const s = client.chatStream([{ type: "user", text: "hi" }], [], {});
      await s.next();

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

  describe("message conversion", () => {
    it("groups all tool_results into one user message after the tool_use message", async () => {
      const client = new AnthropicClient();
      const s = client.chatStream(
        [
          { type: "user", text: "task" },
          { type: "tool_use", id: "call_1", name: "Read", input: {} },
          { type: "tool_use", id: "call_2", name: "Shell", input: {} },
          { type: "tool_result", tool_use_id: "call_1", content: "read-out" },
          { type: "tool_result", tool_use_id: "call_2", content: "shell-out" },
        ],
        [],
        {},
      );
      await s.next();

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "task" },
            {
              role: "assistant",
              content: [
                { type: "tool_use", id: "call_1", name: "Read", input: {} },
                { type: "tool_use", id: "call_2", name: "Shell", input: {} },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_1",
                  content: "read-out",
                },
                {
                  type: "tool_result",
                  tool_use_id: "call_2",
                  content: "shell-out",
                },
              ],
            },
          ],
        }),
        expect.anything(),
      );
    });

    it("flushes tool_results before the next user message", async () => {
      const client = new AnthropicClient();
      const s = client.chatStream(
        [
          { type: "user", text: "u1" },
          { type: "tool_use", id: "call_1", name: "Read", input: {} },
          { type: "tool_result", tool_use_id: "call_1", content: "out" },
          { type: "user", text: "u2" },
        ],
        [],
        {},
      );
      await s.next();

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "u1" },
            {
              role: "assistant",
              content: [
                { type: "tool_use", id: "call_1", name: "Read", input: {} },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call_1",
                  content: "out",
                },
              ],
            },
            { role: "user", content: "u2" },
          ],
        }),
        expect.anything(),
      );
    });

    it("filters thinking blocks out of assistant messages", async () => {
      const client = new AnthropicClient();
      const s = client.chatStream(
        [
          { type: "user", text: "u1" },
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "answer" },
        ],
        [],
        {},
      );
      await s.next();

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "u1" },
            { role: "assistant", content: [{ type: "text", text: "answer" }] },
          ],
        }),
        expect.anything(),
      );
    });
  });
});
