import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionService } from "./permission.js";
import type { LLMClient } from "../llm/client.js";

describe("PermissionService", () => {
  describe("getMode", () => {
    it("returns initial mode", () => {
      const service = new PermissionService({ initialMode: "yolo" });
      expect(service.getMode()).toBe("yolo");
    });
  });

  describe("setMode", () => {
    it("sets mode directly", () => {
      const service = new PermissionService({ initialMode: "manual" });
      service.setMode("auto");
      expect(service.getMode()).toBe("auto");
    });
  });

  describe("cycleMode", () => {
    it("cycles from manual to yolo", () => {
      const service = new PermissionService({ initialMode: "manual" });
      expect(service.cycleMode()).toBe("yolo");
    });

    it("cycles from yolo to auto", () => {
      const service = new PermissionService({ initialMode: "yolo" });
      expect(service.cycleMode()).toBe("auto");
    });

    it("cycles from auto to manual", () => {
      const service = new PermissionService({ initialMode: "auto" });
      expect(service.cycleMode()).toBe("manual");
    });

    it("cycles through all modes", () => {
      const service = new PermissionService({ initialMode: "manual" });
      expect(service.cycleMode()).toBe("yolo");
      expect(service.cycleMode()).toBe("auto");
      expect(service.cycleMode()).toBe("manual");
    });
  });

  describe("check", () => {
    it("yolo always returns allowed: true", async () => {
      const service = new PermissionService({ initialMode: "yolo" });
      const result = await service.check(
        "Bash",
        { command: "rm -rf /" },
        "Dangerous command",
      );
      expect(result).toEqual({ allowed: true });
    });

    it("manual uses prompter.prompt when available", async () => {
      const service = new PermissionService({ initialMode: "manual" });
      const promptMock = vi.fn().mockResolvedValue("yes");
      service.setPrompter({ prompt: promptMock });
      const result = await service.check(
        "Bash",
        { command: "ls" },
        "List files",
      );
      expect(result).toEqual({ allowed: true });
      expect(promptMock).toHaveBeenCalledWith({
        message: expect.stringContaining("List files"),
        options: expect.arrayContaining([{ label: "Yes", value: "yes" }]),
      });
    });

    it("manual returns allowed: false and reason when prompter is undefined (no UI to ask)", async () => {
      const service = new PermissionService({ initialMode: "manual" });
      const result = await service.check(
        "Bash",
        { command: "ls" },
        "List files",
      );
      expect(result).toEqual({ allowed: false, reason: "User cancelled" });
    });

    it('manual returns allowed: false and "User rejected" when prompter returns no', async () => {
      const service = new PermissionService({ initialMode: "manual" });
      const promptMock = vi.fn().mockResolvedValue("no");
      service.setPrompter({ prompt: promptMock });
      const result = await service.check(
        "Bash",
        { command: "ls" },
        "List files",
      );
      expect(result).toEqual({ allowed: false, reason: "User rejected" });
    });

    it('manual returns allowed: false and "User cancelled" when prompter returns empty', async () => {
      const service = new PermissionService({ initialMode: "manual" });
      const promptMock = vi.fn().mockResolvedValue("");
      service.setPrompter({ prompt: promptMock });
      const result = await service.check(
        "Bash",
        { command: "ls" },
        "List files",
      );
      expect(result).toEqual({ allowed: false, reason: "User cancelled" });
    });
  });

  describe("autoDecide", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns allowed: false and reason when client is not set", async () => {
      const service = new PermissionService({ initialMode: "auto" });
      const result = await (service as any).autoDecide("Bash", {
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
      const service = new PermissionService({
        initialMode: "auto",
        client: mockClient,
        model: "claude-3",
      });

      const result = await (service as any).autoDecide("Read", {
        path: "a.txt",
      });

      expect(result).toEqual({ allowed: true });
      expect(mockClient.chatStream).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ role: "user" })]),
        [],
        expect.objectContaining({ model: "claude-3", maxTokens: 100 }),
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
      const service = new PermissionService({
        initialMode: "auto",
        client: mockClient,
      });

      const result = await (service as any).autoDecide("Bash", {
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
      const service = new PermissionService({
        initialMode: "auto",
        client: mockClient,
      });

      const result = await (service as any).autoDecide("Bash", {
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
      const service = new PermissionService({
        initialMode: "auto",
        client: mockClient,
      });

      const result = await (service as any).autoDecide("Bash", {
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
      const service = new PermissionService({
        initialMode: "auto",
        client: mockClient,
      });

      const result = await (service as any).autoDecide("Bash", {
        command: "ls",
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("API error");
    });
  });
});
