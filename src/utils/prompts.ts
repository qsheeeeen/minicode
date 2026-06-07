import fs from "fs/promises";
import path from "path";
import os from "os";

export async function readPromptFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim();
  } catch {
    return "";
  }
}

export async function loadGlobalPrompt(): Promise<string> {
  const globalPromptPath = path.join(os.homedir(), ".minicode", "AGENTS.md");
  return readPromptFile(globalPromptPath);
}

export async function loadProjectPrompt(cwd: string): Promise<string> {
  const projectPromptPath = path.join(cwd, "AGENTS.md");
  return readPromptFile(projectPromptPath);
}
