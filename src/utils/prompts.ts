import fs from "fs/promises";
import path from "path";
import os from "os";

export const DEFAULT_PROMPT_FILE = "AGENTS.md";

export async function readPromptFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim();
  } catch {
    return "";
  }
}

export async function loadGlobalPrompt(): Promise<string> {
  const globalPromptPath = path.join(
    os.homedir(),
    ".minicode",
    DEFAULT_PROMPT_FILE,
  );
  return readPromptFile(globalPromptPath);
}

export async function loadProjectPrompt(
  cwd: string,
  promptFile: string = DEFAULT_PROMPT_FILE,
): Promise<string> {
  const projectPromptPath = path.join(cwd, promptFile);
  return readPromptFile(projectPromptPath);
}
