// PromptManager owns all prompt-related state and construction.
//
// Self-contained with zero cross-dependencies on other managers.
// Agent calls refreshEnvironment() on init and getSystemPrompt() before each
// chatStream call.

import { buildSystemPrompt } from "../utils/prompts.js";

export class PromptManager {
  private userPrompt: string;
  private projectPromptFile: string;
  private roleSystemPrompt: string;
  private skills: ReadonlyArray<{ name: string; description: string }>;
  private environmentContext = "";
  private systemPrompt = "";

  constructor(
    userPrompt: string = "",
    projectPromptFile: string = "",
    roleSystemPrompt: string = "",
    skills: ReadonlyArray<{ name: string; description: string }> = [],
  ) {
    this.userPrompt = userPrompt;
    this.projectPromptFile = projectPromptFile;
    this.roleSystemPrompt = roleSystemPrompt;
    this.skills = skills;
    this.refreshSystemPrompt();
  }

  /** Adopt a fresh environment snapshot (gathered by the caller through the
   *  shell port) and rebuild the system prompt. */
  refreshEnvironment(environmentContext = ""): void {
    this.environmentContext = environmentContext;
    this.refreshSystemPrompt();
  }

  /** Rebuild system prompt from current state. */
  private refreshSystemPrompt(): void {
    this.systemPrompt = buildSystemPrompt({
      environmentContext: this.environmentContext,
      userPrompt: this.userPrompt,
      projectPromptFile: this.projectPromptFile,
      roleSystemPrompt: this.roleSystemPrompt,
      skills: this.skills,
    });
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getUserPrompt(): string {
    return this.userPrompt;
  }
}
