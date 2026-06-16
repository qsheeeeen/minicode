import type { Model } from "../../llm/model.js";
import type { SessionStats } from "../../services/session-stats.js";
import type { SessionManager } from "../../services/session-manager.js";
import type { ChangeJournal } from "../../services/change-journal.js";
import type { LLMBlock, LLMContext } from "../../llm/context.js";
import type { AppConfig, Providers } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { ContextManager } from "../../services/context-manager.js";
import type { ChangeEntry } from "../../services/change-journal.js";
import type { StatusReporter } from "../../services/session-manager.js";
import { getSkillBody, getAvailableSkills } from "../../skills/index.js";
import {
  registerCommand,
  getCommand,
  getCommandNames,
  getAllCommands,
} from "./registry.js";

export type { CommandHandler } from "./registry.js";
export { registerCommand, getCommandNames } from "./registry.js";

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
      changeJournal: ChangeJournal;
      context: LLMContext;
      reportStatus: StatusReporter;
    };

export function inputRequestToState(
  request: InputRequest,
): { mode: string; props: Record<string, unknown> } {
  switch (request.type) {
    case "effort-picker":
      return { mode: "effort-select", props: {} };
    case "session-picker":
      return {
        mode: "session-list",
        props: { sessions: request.sessions },
      };
    case "model-picker":
      return {
        mode: "model-select",
        props: { providers: request.providers, tiers: request.tiers },
      };
    case "rollback-picker":
      return {
        mode: "undo",
        props: {
          totalUserMessages: request.totalUserMessages,
          entriesByUserMessage: request.entriesByUserMessage,
          userMessages: request.userMessages,
          changeJournal: request.changeJournal,
          context: request.context,
          reportStatus: request.reportStatus,
        },
      };
  }
}

export interface CommandContext {
  model: Model;
  config: AppConfig;
  context: LLMContext;
  sessionManager: SessionManager;
  changeJournal: ChangeJournal;
  sessionStats: SessionStats;
  modelSwitchService: ModelSwitchService;
  contextManager: ContextManager;
  isAgentRunning: () => boolean;
  loadContext: (blocks: LLMBlock[], totalTokens?: number) => void;
  switchSession: (
    name: string,
    opts?: { statusMessage?: string },
  ) => Promise<void>;
  renameCurrentSession: (newName: string) => Promise<void>;
  presentInput: (request: InputRequest) => void;
  exit: () => void;
}

export async function executeCommand(
  name: string,
  args: string[],
  context: CommandContext,
): Promise<{
  handled: boolean;
  promptText?: string;
  displayContent?: string;
}> {
  const cmd = getCommand(name);
  if (cmd) {
    if (cmd.handler) {
      await cmd.handler(args, context);
      return { handled: true };
    }
    if (cmd.prompt) {
      return {
        handled: true,
        promptText: cmd.prompt(args),
        displayContent: `/${name}`,
      };
    }
  }

  // Dynamic skill commands: if no builtin command matched, check skills
  const body = getSkillBody(name);
  if (body) {
    return {
      handled: true,
      promptText: `Activate and execute the '${name}' skill.\n\n${body}`,
      displayContent: `/${name}`,
    };
  }

  return { handled: false };
}

export function getCommandList(): Array<{ name: string; description: string }> {
  const builtin = getAllCommands().map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
  }));
  const skills = getAvailableSkills()
    .filter((s) => !getCommandNames().includes(s.name))
    .map((s) => ({ name: s.name, description: s.description }));
  return [...builtin, ...skills].sort((a, b) => a.name.localeCompare(b.name));
}

export function getHelp(): string {
  const lines = ["Available commands:"];
  for (const cmd of getCommandList()) {
    lines.push(`  /${cmd.name} - ${cmd.description}`);
  }
  lines.push("  !<command> - Run a shell command directly");
  return lines.join("\n");
}

// Side-effect import: registers all builtin commands.
// registry.ts has no circular dependency on this file, so builtin/*.ts
// can safely import from registry.ts.
import "./builtin/index.js";
