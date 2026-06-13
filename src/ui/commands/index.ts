import type { Agent } from "../../agent.js";
import type { DisplayMessage } from "../../messages.js";
import type { Model } from "../../llm/model.js";
import type { SessionStats } from "../../services/session-stats.js";
import type { SessionManager } from "../../services/session-manager.js";
import type { ChangeJournal } from "../../services/change-journal.js";
import type { Signal } from "../../utils/signal.js";
import type { LLMContextManager } from "../../context/index.js";
import type { AppConfig } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import { getSkillBody, getAvailableSkills } from "../../skills/index.js";
import {
  registerCommand,
  getCommand,
  getCommandNames,
  getAllCommands,
} from "./registry.js";

export type { CommandHandler } from "./registry.js";
export { registerCommand, getCommandNames } from "./registry.js";

export interface CommandContext {
  agent: Agent;
  model: Model;
  config: AppConfig;
  context: LLMContextManager;
  sessionManager: SessionManager;
  changeJournal: ChangeJournal;
  tokenCount$: Signal<number>;
  sessionStats: SessionStats;
  modelSwitchService: ModelSwitchService;
  setMessages: (msg: DisplayMessage[]) => void;
  setCurrentSession: (name: string) => void;
  setMode: (mode: "chat" | "session-list" | "effort-select") => void;
  setInputMode: (mode: string, props?: Record<string, unknown>) => void;
  setSessionList: (sessions: Array<{ name: string }>) => void;
  setSelectedIndex: (index: number) => void;
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
