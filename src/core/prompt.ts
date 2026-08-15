// The human-prompt port. Lives in core because two directions need it
// (tools surface prompts, services/permission asks) — neither owns it.

export interface PromptOption {
  label: string;
  value: string;
  description?: string;
}

export interface Prompt {
  message: string;
  options: PromptOption[];
  multiSelect?: boolean;
}

/** Agent asks, human answers (resolved via the injected prompter). */
export interface UserPrompter {
  prompt(req: Prompt): Promise<string>;
}
