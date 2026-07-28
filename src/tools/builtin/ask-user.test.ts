import { describe, it, expect, vi } from "vitest";
import { askUserTool } from "./ask-user.js";

describe("askUserTool", () => {
  describe("execute", () => {
    it("returns user selection on answer", async () => {
      const mockPrompt = vi.fn().mockResolvedValue("Option A");
      const result = await askUserTool.execute(
        {
          question: "Which approach?",
          options: [
            { label: "Option A", description: "First approach" },
            { label: "Option B", description: "Second approach" },
          ],
        },
        { prompter: { prompt: mockPrompt } } as any,
      );

      expect(result).toEqual({
        outcome: "success",
        result: 'User selected: "Option A"',
      });
      expect(mockPrompt).toHaveBeenCalledWith({
        message: "Which approach?",
        options: [
          {
            label: "Option A",
            description: "First approach",
            value: "Option A",
          },
          {
            label: "Option B",
            description: "Second approach",
            value: "Option B",
          },
        ],
        multiSelect: false,
      });
    });

    it("returns a denial when user cancels", async () => {
      const mockPrompt = vi.fn().mockResolvedValue(null);
      const result = await askUserTool.execute(
        {
          question: "Pick one",
          options: [
            { label: "X", description: "x" },
            { label: "Y", description: "y" },
          ],
        },
        { prompter: { prompt: mockPrompt } } as any,
      );
      expect(result).toEqual({
        outcome: "denied",
        reason: "User cancelled the question",
      });
    });

    it("passes multiSelect when true", async () => {
      const mockPrompt = vi.fn().mockResolvedValue("A, B");
      await askUserTool.execute(
        {
          question: "Pick multiple",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
          ],
          multiSelect: true,
        },
        { prompter: { prompt: mockPrompt } } as any,
      );

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ multiSelect: true }),
      );
    });

    it("returns error when options is not an array", async () => {
      const result = await askUserTool.execute(
        { question: "What?", options: null } as any,
        {} as any,
      );
      expect(result).toMatchObject({
        outcome: "error",
        reason: expect.stringContaining("must be an array"),
      });
    });

    it("defaults multiSelect to false when omitted", async () => {
      const mockPrompt = vi.fn().mockResolvedValue("A");
      await askUserTool.execute(
        {
          question: "Pick one",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
          ],
        },
        { prompter: { prompt: mockPrompt } } as any,
      );

      expect(mockPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ multiSelect: false }),
      );
    });
  });
});
