import { describe, it, expect, vi } from "vitest";
import {
  RecordEvents,
  RecordPrompter,
  CallbackEvents,
  CallbackPrompter,
  ConsoleEvents,
  ConsolePrompter,
} from "./display.js";

describe("RecordEvents", () => {
  it("records status events", () => {
    const events = new RecordEvents();
    events.status("test message");
    expect(events.events).toHaveLength(1);
    expect(events.events[0].type).toBe("status");
    expect(events.events[0].data).toBe("test message");
  });

  it("records error events", () => {
    const events = new RecordEvents();
    events.error("error message");
    expect(events.events).toHaveLength(1);
    expect(events.events[0].type).toBe("error");
    expect(events.events[0].data).toBe("error message");
  });

  it("records tokenUpdate events", () => {
    const events = new RecordEvents();
    events.tokenUpdate(1000);
    expect(events.events).toHaveLength(1);
    expect(events.events[0].type).toBe("tokenUpdate");
    expect(events.events[0].data).toBe(1000);
  });

  it("records multiple events in order", () => {
    const events = new RecordEvents();
    events.status("first");
    events.tokenUpdate(100);
    events.error("second");
    expect(events.events).toHaveLength(3);
    expect(events.events[0].data).toBe("first");
    expect(events.events[1].data).toBe(100);
    expect(events.events[2].data).toBe("second");
  });

  it("includes timestamp on events", () => {
    const events = new RecordEvents();
    events.status("test");
    expect(events.events[0].timestamp).toBeInstanceOf(Date);
  });
});

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

describe("CallbackEvents", () => {
  it("calls onStatus for status", () => {
    const onStatus = vi.fn();
    const events = new CallbackEvents({ onStatus });
    events.status("test status");
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "status",
        content: "test status",
      }),
    );
  });

  it("calls onStatus for error", () => {
    const onStatus = vi.fn();
    const events = new CallbackEvents({ onStatus });
    events.error("test error");
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "error",
        content: "test error",
      }),
    );
  });

  it("calls onTokenUpdate for tokenUpdate", () => {
    const onTokenUpdate = vi.fn();
    const events = new CallbackEvents({ onTokenUpdate });
    events.tokenUpdate(5000);
    expect(onTokenUpdate).toHaveBeenCalledWith(5000);
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

describe("ConsoleEvents", () => {
  it("implements AgentEvents interface", () => {
    const events = new ConsoleEvents();
    expect(typeof events.status).toBe("function");
    expect(typeof events.error).toBe("function");
    expect(typeof events.tokenUpdate).toBe("function");
  });
});

describe("ConsolePrompter", () => {
  it("implements UserPrompter interface", () => {
    const prompter = new ConsolePrompter();
    expect(typeof prompter.prompt).toBe("function");
  });
});
