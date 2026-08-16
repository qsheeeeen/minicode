import fs from "fs/promises";
import path from "path";
import os from "os";

export const SYSTEM_PROMPT = `You are an interactive CLI coding agent that helps users with software engineering tasks. Use the following instructions and available tools to assist the user.

# Guidelines:
- Always think and respond in the language the user first spoke at the start of the conversation
- Use Shell for file operations like ls, grep, find
- Read files with Read before editing
- Use Write only when creating new files or fully rewriting
- When summarizing actions, output plain text directly - do not use cat or Shell to show what you did
- Keep responses concise and precise - do not use metaphors
- Show file paths clearly when operating on files
- Assess impact before operations and confirm irreversible actions with the user; confirmations are single-use
- You may call multiple tools in a single response
- Parallelize appropriately to improve efficiency
- Use read-only subagents for parallel investigation tasks: code exploration, code review, debugging research, documentation generation, and dependency analysis. Do not use subagents for simple lookups or when a direct grep/find suffices.`;

export interface SystemPromptOptions {
  environmentContext?: string;
  userPrompt?: string;
  projectPromptFile?: string;
  /** Role prompt for a spawned sub-agent (e.g. researcher/reviewer). */
  roleSystemPrompt?: string;
  /** Skills available for discovery (injected, never read from globals). */
  skills?: ReadonlyArray<{ name: string; description: string }>;
}

/**
 * Build the full system prompt from its components.
 * Pure function — no side effects.
 */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  let prompt = SYSTEM_PROMPT;

  if (opts.roleSystemPrompt) {
    prompt += `\n\n# Role\n${opts.roleSystemPrompt}`;
  }

  if (opts.environmentContext) {
    prompt += `\n\n# Environment\n${opts.environmentContext}`;
  }

  if (opts.userPrompt) {
    prompt += `\n\n# Additional Instructions\n${opts.userPrompt}`;
  }

  if (opts.projectPromptFile) {
    prompt += `\n\n# Workspace Information\nThis workspace's description is in \`${opts.projectPromptFile}\`. Use the Read tool to load it at the start of each conversation. Note: the description may be outdated — always verify against the actual code when in doubt.`;
  }

  const availableSkills = opts.skills ?? [];
  if (availableSkills.length > 0) {
    prompt += `\n\n<available_skills>\n`;
    availableSkills.forEach((skill) => {
      prompt += `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description}</description>\n  </skill>\n`;
    });
    prompt += `</available_skills>\n`;
    prompt += `\nTo load a skill and receive its detailed instructions, use the LoadSkill tool with the skill's name.\n`;
  }

  return prompt;
}

/** Format the environment snapshot for the system prompt. The caller
 *  gathers the git status through the shell port; this stays pure. */
export function formatEnvironmentContext(gitStatus?: string): string {
  let ctx = `Working directory: ${process.cwd()}\n`;
  if (gitStatus?.trim()) {
    ctx += `\n${gitStatus.trim()}\n`;
    ctx += `\nThis is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`;
  }
  return ctx;
}

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
