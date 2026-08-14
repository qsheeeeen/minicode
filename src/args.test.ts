import { describe, it, expect } from "vitest";
import { Args } from "./args.js";
import { AppConfig } from "./config.js";

const baseConfig = new AppConfig({
  providers: {
    anthropic: { apiKey: "key" },
  },
  compressionThreshold: 0.8,
  permissionMode: "manual",
});

describe("Args", () => {
  it("returns config defaults for empty args", () => {
    const args = new Args(["node", "minicode"], baseConfig);
    expect(args.model).toBeNull();
    expect(args.permissionMode).toBe("manual");
    expect(args.compressionThreshold).toBe(0.8);
    expect(args.resumeRecent).toBe(false);
    expect(args.headless).toBeUndefined();
    expect(args.initialPrompt).toBeUndefined();
  });

  it("--model overrides config model", () => {
    const args = new Args(
      ["node", "minicode", "--model", "claude-3@anthropic"],
      baseConfig,
    );
    expect(args.model?.model).toBe("claude-3");
    expect(args.model?.provider).toBe("anthropic");
  });

  it("uses config model when --model not given", () => {
    const config = new AppConfig({
      ...baseConfig,
      // pre-resolved model not stored; use spec
    });
    const args = new Args(["node", "minicode"], config);
    expect(args.model).toBeNull();
  });

  it("parses --session", () => {
    const args = new Args(
      ["node", "minicode", "--session", "my-session"],
      baseConfig,
    );
    expect(args.sessionName).toBe("my-session");
  });

  it("parses --resume", () => {
    const args = new Args(["node", "minicode", "--resume"], baseConfig);
    expect(args.resumeRecent).toBe(true);
  });

  it("parses --headless", () => {
    const args = new Args(["node", "minicode", "--headless"], baseConfig);
    expect(args.headless).toBe(true);
  });

  it("--permission overrides config permissionMode", () => {
    const args = new Args(
      ["node", "minicode", "--permission", "yolo"],
      baseConfig,
    );
    expect(args.permissionMode).toBe("yolo");
  });

  it("uses config permissionMode when --permission not given", () => {
    const config = new AppConfig({ ...baseConfig, permissionMode: "auto" });
    const args = new Args(["node", "minicode"], config);
    expect(args.permissionMode).toBe("auto");
  });

  it("throws on invalid permission mode", () => {
    expect(
      () =>
        new Args(["node", "minicode", "--permission", "invalid"], baseConfig),
    ).toThrow();
  });

  it("parses positional argument as initialPrompt", () => {
    const args = new Args(["node", "minicode", "list files"], baseConfig);
    expect(args.initialPrompt).toBe("list files");
  });

  it("parses prompt after flags", () => {
    const args = new Args(
      [
        "node",
        "minicode",
        "--headless",
        "--model",
        "claude-3@anthropic",
        "fix the bug",
      ],
      baseConfig,
    );
    expect(args.initialPrompt).toBe("fix the bug");
    expect(args.headless).toBe(true);
    expect(args.model?.model).toBe("claude-3");
  });
});
