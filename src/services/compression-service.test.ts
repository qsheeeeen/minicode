import { describe, it, expect, vi, beforeEach } from "vitest";
import { SummaryCompressionStrategy } from "./compression-service.js";
import type { LLMClient } from "../llm/client.js";
import type { ContextTurn } from "../context/index.js";
import { Model } from "../llm/model.js";

describe("SummaryCompressionStrategy", () => {
  let service: SummaryCompressionStrategy;

  beforeEach(() => {
    service = new SummaryCompressionStrategy();
  });

  describe("compress", () => {
    it("returns unchanged turns when below threshold (12 or fewer)", async () => {
      const turns: ContextTurn[] = Array.from({ length: 12 }, (_, i) => ({
        userText: `message ${i}`,
        process: [],
      }));
      const mockClient = {} as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);
      const result = await service.compress(turns, mockClient, model);
      expect(result).toEqual(turns);
    });

    it("compresses when above threshold (more than 12 turns)", async () => {
      const turns: ContextTurn[] = Array.from({ length: 15 }, (_, i) => ({
        userText: `message ${i}`,
        process: [],
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: {
              content: [{ type: "text", text: "Summary of conversation" }],
            },
          }),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);

      const result = await service.compress(turns, mockClient, model);

      // Should include summary and last 10 turns
      expect(result.length).toBeLessThan(turns.length);
      expect(result[0]).toEqual({
        userText: expect.stringContaining("Summary"),
        process: [],
      });
    });

    it("throws error when compression fails", async () => {
      const turns: ContextTurn[] = Array.from({ length: 15 }, (_, i) => ({
        userText: `message ${i}`,
        process: [],
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          finalMessage: vi.fn().mockRejectedValue(new Error("API error")),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);

      await expect(service.compress(turns, mockClient, model)).rejects.toThrow(
        "Compression failed",
      );
    });

    it("calls client.chat with correct parameters", async () => {
      const turns: ContextTurn[] = Array.from({ length: 15 }, (_, i) => ({
        userText: `message ${i}`,
        process: [],
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "Summary" }] },
          }),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);

      await service.compress(turns, mockClient, model);

      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Summarize"),
          }),
        ]),
        [],
        expect.objectContaining({ model, maxTokens: 1000 }),
      );
    });

    it("uses last 10 turns in result", async () => {
      const turns: ContextTurn[] = Array.from({ length: 15 }, (_, i) => ({
        userText: `msg${i}`,
        process: [],
      }));
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "Summary" }] },
          }),
        }),
      } as unknown as LLMClient;

      const result = await service.compress(turns, mockClient, undefined);

      // Last 10 turns should be preserved
      const last10 = turns.slice(-10);
      expect(result.slice(-10)).toEqual(last10);
    });
  });
});
