import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSystemPrompt,
  readPromptFile,
  loadGlobalPrompt,
} from "./prompts.js";

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe("readPromptFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed content on success", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      "  hello world  \n",
    );
    const result = await readPromptFile("prompt.md");
    expect(result).toBe("hello world");
  });

  it("returns empty string on error", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ENOENT"),
    );
    const result = await readPromptFile("nonexistent.md");
    expect(result).toBe("");
  });
});

describe("loadGlobalPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads from ~/.minicode/MINICODE.md", async () => {
    const fs = await import("fs/promises");
    (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      "global prompt content",
    );
    await loadGlobalPrompt();
    const readCall = (fs.default.readFile as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(readCall).toContain(".minicode");
    expect(readCall).toContain("AGENTS.md");
  });
});

describe("buildSystemPrompt", () => {
  it("includes roleSystemPrompt as a section", () => {
    const prompt = buildSystemPrompt({
      roleSystemPrompt: "you are a reviewer",
    });
    expect(prompt).toContain("you are a reviewer");
    expect(prompt).toContain("# Role");
  });

  it("omits role section when not provided", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("# Role");
  });

  it("includes available skills when provided", () => {
    const prompt = buildSystemPrompt({
      skills: [{ name: "my-skill", description: "A test skill" }],
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>my-skill</name>");
    expect(prompt).toContain("A test skill");
  });

  it("omits the skills section when none are provided", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("<available_skills>");
  });
});
