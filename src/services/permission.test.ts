import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionService, AutoPermissionStrategy } from "./permission.js";
import type { LLMClient } from "../llm/client.js";
import { Model } from "../llm/model.js";
import { RuntimeEvents } from "./runtime-events.js";

describe("PermissionService", () => {
  describe("getMode", () => {
    it("returns initial mode", () => {
      const service = new PermissionService("yolo");
      expect(service.getMode()).toBe("yolo");
    });
  });

  describe("setMode", () => {
    it("sets mode directly", () => {
      const service = new PermissionService("manual");
      service.setMode("auto");
      expect(service.getMode()).toBe("auto");
    });

    it("emits permission.mode_changed when events are provided", () => {
      const events = new RuntimeEvents();
      const seen: Array<"manual" | "yolo" | "auto"> = [];
      events.subscribe((event) => {
        if (event.type === "permission.mode_changed") seen.push(event.mode);
      });
      const service = new PermissionService(
        "manual",
        undefined,
        undefined,
        events,
      );
      service.setMode("auto");
      service.cycleMode(); // auto -> manual
      expect(seen).toEqual(["auto", "manual"]);
    });
  });

  describe("cycleMode", () => {
    it("cycles from manual to yolo", () => {
      const service = new PermissionService("manual");
      expect(service.cycleMode()).toBe("yolo");
    });

    it("cycles from yolo to auto", () => {
      const service = new PermissionService("yolo");
      expect(service.cycleMode()).toBe("auto");
    });

    it("cycles from auto to manual", () => {
      const service = new PermissionService("auto");
      expect(service.cycleMode()).toBe("manual");
    });

    it("cycles through all modes", () => {
      const service = new PermissionService("manual");
      expect(service.cycleMode()).toBe("yolo");
      expect(service.cycleMode()).toBe("auto");
      expect(service.cycleMode()).toBe("manual");
    });
  });

  describe("check", () => {
    it("yolo always returns allowed: true", async () => {
      const service = new PermissionService("yolo");
      const result = await service.check(
        "Shell",
        { command: "rm -rf /" },
        "Dangerous command",
      );
      expect(result).toEqual({ allowed: true });
    });

    it("manual uses prompter.prompt when available", async () => {
      const service = new PermissionService("manual");
      const promptMock = vi.fn().mockResolvedValue("yes");
      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
        { prompt: promptMock },
      );
      expect(result).toEqual({ allowed: true });
      expect(promptMock).toHaveBeenCalledWith({
        message: expect.stringContaining("List files"),
        options: expect.arrayContaining([{ label: "Yes", value: "yes" }]),
      });
    });

    it("manual returns allowed: false and reason when prompter is undefined (no UI to ask)", async () => {
      const service = new PermissionService("manual");
      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
      );
      expect(result).toEqual({ allowed: false, reason: "User cancelled" });
    });

    it("manual switches to yolo when the user answers yes to all", async () => {
      const service = new PermissionService("manual");
      const promptMock = vi.fn().mockResolvedValue("yolo");

      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
        { prompt: promptMock },
      );

      expect(result).toEqual({
        allowed: true,
        reason: "yolo",
        switchToMode: "yolo",
      });
      expect(service.getMode()).toBe("yolo");
    });

    it("emits permission.mode_changed when yes to all switches mode", async () => {
      const events = new RuntimeEvents();
      const seen: Array<"manual" | "yolo" | "auto"> = [];
      events.subscribe((event) => {
        if (event.type === "permission.mode_changed") seen.push(event.mode);
      });
      const service = new PermissionService(
        "manual",
        undefined,
        undefined,
        events,
      );
      const promptMock = vi.fn().mockResolvedValue("yolo");

      await service.check("Shell", { command: "ls" }, "List files", {
        prompt: promptMock,
      });

      expect(seen).toEqual(["yolo"]);
    });

    it("does not prompt again after yes to all switched to yolo", async () => {
      const service = new PermissionService("manual");
      const promptMock = vi.fn().mockResolvedValue("yolo");
      await service.check("Shell", { command: "ls" }, "List files", {
        prompt: promptMock,
      });
      promptMock.mockClear();

      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
        { prompt: promptMock },
      );

      expect(result).toEqual({ allowed: true });
      expect(promptMock).not.toHaveBeenCalled();
    });

    it("keeps strategies scoped to each service instance", async () => {
      const first = new PermissionService("auto");
      const second = new PermissionService("auto");
      first.setStrategy("auto", {
        check: vi.fn().mockResolvedValue({ allowed: true }),
      });

      await expect(first.check("Shell", {}, "Shell(ls)")).resolves.toEqual({
        allowed: true,
      });
      await expect(second.check("Shell", {}, "Shell(ls)")).resolves.toEqual({
        allowed: false,
        reason: expect.stringContaining("No LLM client"),
      });
    });

    it("can update the auto gate client and model", async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "yes" }] },
          }),
        }),
      } as unknown as LLMClient;
      const service = new PermissionService("auto");
      const model = new Model("new-model", "test-provider", 1000);

      service.updateAutoGate(mockClient, model);
      const result = await service.check(
        "Shell",
        { command: "ls" },
        "Shell(ls)",
      );

      expect(result).toEqual({ allowed: true });
      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.any(Array),
        [],
        expect.objectContaining({ model }),
      );
    });

    it('manual returns allowed: false and "User rejected" when prompter returns no', async () => {
      const service = new PermissionService("manual");
      const promptMock = vi.fn().mockResolvedValue("no");
      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
        { prompt: promptMock },
      );
      expect(result).toEqual({ allowed: false, reason: "User rejected" });
    });

    it('manual returns allowed: false and "User cancelled" when prompter returns empty', async () => {
      const service = new PermissionService("manual");
      const promptMock = vi.fn().mockResolvedValue("");
      const result = await service.check(
        "Shell",
        { command: "ls" },
        "List files",
        { prompt: promptMock },
      );
      expect(result).toEqual({ allowed: false, reason: "User cancelled" });
    });
  });

  describe("AutoPermissionStrategy", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns allowed: false and reason when client is not set", async () => {
      const strategy = new AutoPermissionStrategy();
      const result = await strategy.check("Shell", {
        command: "ls",
      });
      expect(result).toEqual({
        allowed: false,
        reason: expect.stringContaining("No LLM client"),
      });
    });

    it('returns allowed: true for "yes" response', async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "yes" }] },
          }),
        }),
      } as unknown as LLMClient;
      const model = new Model("claude-3", "test-provider", 1000);
      const strategy = new AutoPermissionStrategy(mockClient, model);

      const result = await strategy.check("Read", {
        path: "a.txt",
      });

      expect(result).toEqual({ allowed: true });
      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: "user" })]),
        [],
        expect.objectContaining({ model, maxTokens: 100 }),
      );
    });

    it('returns allowed: false and reason for "no: <reason>" response', async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: {
              content: [
                { type: "text", text: "no: this command is too dangerous" },
              ],
            },
          }),
        }),
      } as unknown as LLMClient;
      const strategy = new AutoPermissionStrategy(mockClient);

      const result = await strategy.check("Shell", {
        command: "rm -rf /",
      });

      expect(result).toEqual({
        allowed: false,
        reason: "this command is too dangerous",
      });
    });

    it('returns allowed: true when response starts with "yes"', async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: {
              content: [{ type: "text", text: "yes, this is allowed" }],
            },
          }),
        }),
      } as unknown as LLMClient;
      const strategy = new AutoPermissionStrategy(mockClient);

      const result = await strategy.check("Shell", {
        command: "echo hello",
      });

      expect(result).toEqual({ allowed: true });
    });

    it('returns allowed: false and parses reason when response does not start with "yes"', async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockResolvedValue({
            done: true,
            value: { content: [{ type: "text", text: "I think not." }] },
          }),
        }),
      } as unknown as LLMClient;
      const strategy = new AutoPermissionStrategy(mockClient);

      const result = await strategy.check("Shell", {
        command: "ls",
      });

      expect(result).toEqual({ allowed: false, reason: "I think not." });
    });

    it("returns allowed: false and error reason on chat error", async () => {
      const mockClient = {
        chatStream: vi.fn().mockReturnValue({
          next: vi.fn().mockRejectedValue(new Error("API error")),
        }),
      } as unknown as LLMClient;
      const strategy = new AutoPermissionStrategy(mockClient);

      const result = await strategy.check("Shell", {
        command: "ls",
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("API error");
    });
  });
});
