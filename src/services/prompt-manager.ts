// PromptManager owns all prompt-related state and construction.
//
// Self-contained with zero cross-dependencies on other managers.
// Agent calls refreshEnvironment() on init and getSystemPrompt() before each
// chatStream call.

import {
  buildSystemPrompt,
  getEnvironmentContext,
} from "../utils/prompts.js";

export class PromptManager {
  private userPrompt: string;
  private projectPromptFile: string;
  private roleSystemPrompt: string;
  private environmentContext = "";
  private systemPrompt = "";

  constructor(
    userPrompt: string = "",
    projectPromptFile: string = "",
    roleSystemPrompt: string = "",
  ) {
    this.userPrompt = userPrompt;
    this.projectPromptFile = projectPromptFile;
    this.roleSystemPrompt = roleSystemPrompt;
    this.refreshSystemPrompt();
  }

  /** Fetch runtime environment (git status, cwd) and rebuild system prompt. */
  async refreshEnvironment(): Promise<void> {
    this.environmentContext = await getEnvironmentContext();
    this.refreshSystemPrompt();
  }

  /** Rebuild system prompt from current state. */
  refreshSystemPrompt(): void {
    this.systemPrompt = buildSystemPrompt({
      environmentContext: this.environmentContext,
      userPrompt: this.userPrompt,
      projectPromptFile: this.projectPromptFile,
      roleSystemPrompt: this.roleSystemPrompt,
    });
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getUserPrompt(): string {
    return this.userPrompt;
  }

  setUserPrompt(prompt: string): void {
    this.userPrompt = prompt;
    this.refreshSystemPrompt();
  }

  /** Set the sub-agent role prompt and rebuild. Empty clears it. */
  setRolePrompt(prompt: string): void {
    this.roleSystemPrompt = prompt;
    this.refreshSystemPrompt();
  }

  getProjectPromptFile(): string {
    return this.projectPromptFile;
  }
}
