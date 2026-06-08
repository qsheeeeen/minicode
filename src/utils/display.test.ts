import { describe, it, expect, vi } from "vitest";
import {
  RecordPrompter,
  CallbackPrompter,
  ConsolePrompter,
} from "./display.js";

describe("RecordPrompter", () => {
  it("records prompt and returns empty string", async () => {
    const prompter = new RecordPrompter();
    const result = await prompter.prompt({
      message: "Test?",
      options: [{ label: "Yes", value: "yes" }],
    });
    expect(result).toBe("");
    expect(prompter.events[0].data).toContain("Test?");
  });
});

describe("CallbackPrompter", () => {
  it("calls onPrompt when prompt is called", async () => {
    const onPrompt = vi.fn().mockResolvedValue("yes");
    const prompter = new CallbackPrompter(onPrompt);
    const result = await prompter.prompt({
      message: "Test?",
      options: [{ label: "Yes", value: "yes" }],
    });
    expect(result).toBe("yes");
    expect(onPrompt).toHaveBeenCalledWith({
      message: "Test?",
      options: [{ label: "Yes", value: "yes" }],
    });
  });
});

describe("ConsolePrompter", () => {
  it("implements UserPrompter interface", () => {
    const prompter = new ConsolePrompter();
    expect(typeof prompter.prompt).toBe("function");
  });
});
