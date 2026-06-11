import { describe, it, expect } from "vitest";
import { PromptManager } from "./prompt-manager.js";

describe("PromptManager", () => {
  describe("constructor", () => {
    it("creates instance with default values", () => {
      const pm = new PromptManager();
      expect(pm).toBeDefined();
      expect(pm.getUserPrompt()).toBe("");
      expect(pm.getProjectPromptFile()).toBe("");
    });

    it("accepts userPrompt", () => {
      const pm = new PromptManager("my prompt");
      expect(pm.getUserPrompt()).toBe("my prompt");
    });

    it("accepts projectPromptFile", () => {
      const pm = new PromptManager("", "AGENTS.md");
      expect(pm.getProjectPromptFile()).toBe("AGENTS.md");
    });
  });

  describe("getSystemPrompt", () => {
    it("returns a non-empty string", () => {
      const pm = new PromptManager();
      const prompt = pm.getSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("includes user prompt in system prompt", () => {
      const pm = new PromptManager("test-user-prompt");
      expect(pm.getSystemPrompt()).toContain("test-user-prompt");
    });
  });

  describe("setUserPrompt", () => {
    it("updates the user prompt", () => {
      const pm = new PromptManager();
      pm.setUserPrompt("new prompt");
      expect(pm.getUserPrompt()).toBe("new prompt");
    });

    it("rebuilds system prompt after update", () => {
      const pm = new PromptManager();
      const before = pm.getSystemPrompt();
      pm.setUserPrompt("updated-prompt");
      const after = pm.getSystemPrompt();
      expect(after).toContain("updated-prompt");
      expect(after).not.toBe(before);
    });
  });
});
