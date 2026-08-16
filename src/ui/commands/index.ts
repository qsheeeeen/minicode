import type { Model } from "../../llm/model.js";
import type { SessionStats } from "../../services/session-stats.js";
import type { SessionManager } from "../../services/session-manager.js";
import type { ChangeJournal } from "../../services/change-journal.js";
import type { LLMContext } from "../../core/context.js";
import type { AppConfig, Providers } from "../../config.js";
import type { SkillRegistry } from "../../skills/index.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { ContextManager } from "../../services/context-manager.js";
import type { ChangeEntry } from "../../services/change-journal.js";
import type { InputRouter } from "../routing.js";
import { registerBuiltinCommands } from "./builtin/index.js";
import type { CommandRegistry } from "./registry.js";
import { registerSkillCommands } from "./skill-commands.js";

export type { CommandHandler } from "./registry.js";
export { CommandRegistry } from "./registry.js";
export { registerBuiltinCommands } from "./builtin/index.js";
export { registerSkillCommands } from "./skill-commands.js";
export { createCommandContext } from "./create-context.js";

export type InputRequest =
  | { type: "effort-picker" }
  | {
      type: "session-picker";
      sessions: Array<{ name: string }>;
    }
  | {
      type: "model-picker";
      providers: Providers;
      tiers: Record<string, string>;
    }
  | {
      type: "rollback-picker";
      totalUserMessages: number;
      entriesByUserMessage: Array<{
        userMessageOrdinal: number;
        entries: ChangeEntry[];
      }>;
      userMessages: string[];
    };

export interface CommandContext {
  model: Model;
  config: AppConfig;
  context: LLMContext;
  commands: CommandRegistry;
  skills: SkillRegistry;
  router: InputRouter;
  sessionManager: SessionManager;
  changeJournal: ChangeJournal;
  sessionStats: SessionStats;
  modelSwitchService: ModelSwitchService;
  contextManager: ContextManager;
  isAgentRunning: () => boolean;
  /** Load a persisted session and activate it (session-lifecycle owns it). */
  resumeSession: (name: string) => Promise<{ loaded: boolean }>;
  switchSession: (
    name: string,
    opts?: { statusMessage?: string },
  ) => Promise<void>;
  renameCurrentSession: (newName: string) => Promise<void>;
  presentInput: (request: InputRequest) => void;
  exit: () => void;
}

/** What happened when a command ran — self-describing, not encoded in
 *  which optional fields are present. */
export type ExecuteCommandResult =
  | { kind: "prompt"; promptText: string; displayContent?: string }
  | { kind: "handled" }
  | { kind: "unknown" };

export async function executeCommand(
  name: string,
  args: string[],
  context: CommandContext,
): Promise<ExecuteCommandResult> {
  const cmd = context.commands.get(name);
  if (cmd?.handler) {
    await cmd.handler(args, context);
    return { kind: "handled" };
  }
  if (cmd?.prompt) {
    return {
      kind: "prompt",
      promptText: cmd.prompt(args),
      displayContent: `/${name}`,
    };
  }
  // Skill commands are registered upfront (registerSkillCommands in the
  // composition root) — no dynamic fallback, so only one prompt format exists.
  return { kind: "unknown" };
}

export function getCommandList(
  commands: CommandRegistry,
  skills: SkillRegistry,
): Array<{ name: string; description: string }> {
  const builtin = commands.getAll().map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
  }));
  const skillCommands = skills
    .getAvailable()
    .filter((s) => !commands.getNames().includes(s.name))
    .map((s) => ({ name: s.name, description: s.description }));
  return [...builtin, ...skillCommands].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
