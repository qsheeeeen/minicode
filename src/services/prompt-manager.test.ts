import { describe, it, expect } from "vitest";
import { PromptManager } from "./prompt-manager.js";

describe("PromptManager", () => {
  describe("constructor", () => {
    it("creates instance with default values", () => {
      const pm = new PromptManager();
      expect(pm).toBeDefined();
      expect(pm.getUserPrompt()).toBe("");
    });

    it("accepts userPrompt", () => {
      const pm = new PromptManager("my prompt");
      expect(pm.getUserPrompt()).toBe("my prompt");
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

    it("includes roleSystemPrompt from the constructor", () => {
      const pm = new PromptManager("", "", "you are a planner");
      expect(pm.getSystemPrompt()).toContain("you are a planner");
    });
  });

  describe("refreshEnvironment", () => {
    it("rebuilds system prompt with the environment snapshot", () => {
      const pm = new PromptManager();
      const before = pm.getSystemPrompt();
      pm.refreshEnvironment("os=linux");
      const after = pm.getSystemPrompt();
      expect(after).toContain("os=linux");
      expect(after).not.toBe(before);
    });
  });
});
