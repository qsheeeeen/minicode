import { describe, it, expect, vi, beforeEach } from "vitest";
import { SummaryCompressionStrategy } from "./compression-service.js";
import type { LLMClient } from "../llm/client.js";
import { LLMHistory, type LLMBlock } from "../llm/history.js";
import { Model } from "../llm/model.js";

function userBlocks(count: number, prefix = "message"): LLMBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "user" as const,
    text: `${prefix} ${i}`,
  }));
}

function historyWith(blocks: LLMBlock[]): LLMHistory {
  const history = new LLMHistory();
  history.replaceBlocks(blocks);
  return history;
}

describe("SummaryCompressionStrategy", () => {
  let service: SummaryCompressionStrategy;

  beforeEach(() => {
    service = new SummaryCompressionStrategy();
  });

  describe("compress", () => {
    it("returns unchanged blocks when below threshold (12 or fewer user messages)", async () => {
      const blocks = userBlocks(12);
      const mockClient = {} as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);
      const result = await service.compress(
        historyWith(blocks),
        mockClient,
        model,
      );
      expect(result).toEqual(blocks);
    });

    it("compresses when above threshold (more than 12 user messages)", async () => {
      const blocks = userBlocks(15);
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

      const result = await service.compress(
        historyWith(blocks),
        mockClient,
        model,
      );

      expect(result.length).toBeLessThan(blocks.length);
      expect(result[0]).toEqual({
        type: "user",
        text: expect.stringContaining("Summary"),
      });
    });

    it("throws error when compression fails", async () => {
      const blocks = userBlocks(15);
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockRejectedValue(new Error("API error")),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);

      await expect(
        service.compress(historyWith(blocks), mockClient, model),
      ).rejects.toThrow("Compression failed");
    });

    it("calls client.chat with correct parameters", async () => {
      const blocks = userBlocks(15);
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "Summary" }] },
          }),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);

      await service.compress(historyWith(blocks), mockClient, model);

      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: "user",
            text: expect.stringContaining("Summarize"),
          }),
        ]),
        [],
        expect.objectContaining({ model, maxTokens: 1000 }),
      );
    });

    it("uses last 10 user messages in result", async () => {
      const blocks = userBlocks(15, "msg");
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "Summary" }] },
          }),
        }),
      } as unknown as LLMClient;

      const result = await service.compress(
        historyWith(blocks),
        mockClient,
        undefined,
      );

      expect(result.slice(-10)).toEqual(blocks.slice(-10));
    });
  });
});
