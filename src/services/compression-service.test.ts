import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompressionService } from "./compression-service.js";
import type { LLMClient } from "../llm/client.js";
import type { MessageParam } from "../llm/types.js";

describe("CompressionService", () => {
  let service: CompressionService;

  beforeEach(() => {
    service = new CompressionService();
  });

  describe("compress", () => {
    it("returns unchanged messages when below threshold (12 or fewer)", async () => {
      const messages: MessageParam[] = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));
      const mockClient = {} as LLMClient;
      const result = await service.compress(messages, mockClient, "claude-3");
      expect(result).toEqual(messages);
    });

    it("compresses when above threshold (more than 12 messages)", async () => {
      const messages: MessageParam[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Summary of conversation" }],
          }),
        }),
      } as unknown as LLMClient;

      const result = await service.compress(messages, mockClient, "claude-3");

      // Should include summary and last 10 messages
      expect(result.length).toBeLessThan(messages.length);
      expect(result[0]).toEqual({
        role: "user",
        content: expect.stringContaining("Summary"),
      });
    });

    it("throws error when compression fails", async () => {
      const messages: MessageParam[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockRejectedValue(new Error("API error")),
        }),
      } as unknown as LLMClient;

      await expect(
        service.compress(messages, mockClient, "claude-3"),
      ).rejects.toThrow("Compression failed");
    });

    it("calls client.chat with correct parameters", async () => {
      const messages: MessageParam[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Summary" }],
          }),
        }),
      } as unknown as LLMClient;

      await service.compress(messages, mockClient, "claude-3");

      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Summarize"),
          }),
        ]),
        [],
        expect.objectContaining({ model: "claude-3", maxTokens: 1000 }),
      );
    });

    it("uses last 10 messages in result", async () => {
      const messages: MessageParam[] = Array.from({ length: 15 }, (_, i) => ({
        role: "user" as const,
        content: `msg${i}`,
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Summary" }],
          }),
        }),
      } as unknown as LLMClient;

      const result = await service.compress(messages, mockClient, undefined);

      // Last 10 messages should be preserved
      const last10 = messages.slice(-10);
      expect(result.slice(-10)).toEqual(last10);
    });
  });
});
