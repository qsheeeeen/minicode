import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";
import type { ResolvedConfig } from "./config.js";

const baseConfig: ResolvedConfig = {
  model: null,
  providers: {
    anthropic: { apiKey: "key" },
  },
  compressionThreshold: 0.8,
  thinking: {},
  permissionMode: "manual",
};

describe("parseArgs", () => {
  it("returns config defaults for empty args", () => {
    const result = parseArgs(["node", "minicode"], baseConfig);
    expect(result.model).toBeNull();
    expect(result.permissionMode).toBe("manual");
    expect(result.compressionThreshold).toBe(0.8);
    expect(result.resumeRecent).toBe(false);
    expect(result.headless).toBeUndefined();
    expect(result.initialPrompt).toBeUndefined();
  });

  it("--model overrides config model", () => {
    const result = parseArgs(
      ["node", "minicode", "--model", "claude-3@anthropic"],
      baseConfig,
    );
    expect(result.model?.model).toBe("claude-3");
    expect(result.model?.provider).toBe("anthropic");
  });

  it("uses config model when --model not given", () => {
    const config: ResolvedConfig = {
      ...baseConfig,
      model: {
        provider: "anthropic",
        protocol: "anthropic",
        model: "claude-3",
        apiKey: "key",
      },
    };
    const result = parseArgs(["node", "minicode"], config);
    expect(result.model?.model).toBe("claude-3");
  });

  it("parses --session", () => {
    const result = parseArgs(
      ["node", "minicode", "--session", "my-session"],
      baseConfig,
    );
    expect(result.sessionName).toBe("my-session");
  });

  it("parses --resume", () => {
    const result = parseArgs(["node", "minicode", "--resume"], baseConfig);
    expect(result.resumeRecent).toBe(true);
  });

  it("parses --headless", () => {
    const result = parseArgs(["node", "minicode", "--headless"], baseConfig);
    expect(result.headless).toBe(true);
  });

  it("--permission overrides config permissionMode", () => {
    const result = parseArgs(
      ["node", "minicode", "--permission", "yolo"],
      baseConfig,
    );
    expect(result.permissionMode).toBe("yolo");
  });

  it("uses config permissionMode when --permission not given", () => {
    const config: ResolvedConfig = { ...baseConfig, permissionMode: "auto" };
    const result = parseArgs(["node", "minicode"], config);
    expect(result.permissionMode).toBe("auto");
  });

  it("throws on invalid permission mode", () => {
    expect(() =>
      parseArgs(["node", "minicode", "--permission", "invalid"], baseConfig),
    ).toThrow();
  });

  it("parses positional argument as initialPrompt", () => {
    const result = parseArgs(["node", "minicode", "list files"], baseConfig);
    expect(result.initialPrompt).toBe("list files");
  });

  it("parses prompt after flags", () => {
    const result = parseArgs(
      ["node", "minicode", "--headless", "--model", "claude-3@anthropic", "fix the bug"],
      baseConfig,
    );
    expect(result.initialPrompt).toBe("fix the bug");
    expect(result.headless).toBe(true);
    expect(result.model?.model).toBe("claude-3");
  });
});
