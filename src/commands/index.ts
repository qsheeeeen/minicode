import type { Agent } from "../agent.js";
import type { DisplayMessage } from "../utils/display.js";
import type { EffortLevel } from "../llm/anthropic.js";
import { MessageStore } from "../messages.js";
import { getSkillBody, getAvailableSkills } from "../skills/index.js";
import { createLogger } from "../utils/logger.js";

export interface CommandHandler {
  name: string;
  description: string;
  // System command: directly manipulates app state
  handler?: (args: string[], context: CommandContext) => Promise<void>;
  // Prompt command: returns text to inject into agent conversation
  prompt?: (args: string[]) => string;
}

export interface CommandContext {
  agent: Agent;
  setMessages: (
    msg: DisplayMessage[] | ((prev: DisplayMessage[]) => DisplayMessage[]),
  ) => void;
  setCurrentSession: (name: string) => void;
  setMode: (mode: "chat" | "session-list" | "effort-select") => void;
  setInputMode: (mode: string, props?: Record<string, unknown>) => void;
  setSessionList: (sessions: Array<{ name: string }>) => void;
  setSelectedIndex: (index: number) => void;
  exit: () => void;
}

const commands = new Map<string, CommandHandler>();

export function registerCommand(cmd: CommandHandler): void {
  if (!cmd.handler && !cmd.prompt) {
    throw new Error(
      `Command "${cmd.name}" must have either handler or prompt`,
    );
  }
  if (cmd.handler && cmd.prompt) {
    throw new Error(
      `Command "${cmd.name}" cannot have both handler and prompt`,
    );
  }
  commands.set(cmd.name, cmd);
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
  const cmd = commands.get(name);
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

export function getCommandNames(): string[] {
  return Array.from(commands.keys());
}

export function getCommandList(): Array<{ name: string; description: string }> {
  const builtin = Array.from(commands.values()).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
  }));
  const skills = getAvailableSkills()
    .filter((s) => !commands.has(s.name))
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

// -- builtin commands ---------------------------------------------------------

registerCommand({
  name: "exit",
  description: "Exit the application",
  handler: async (_args, ctx): Promise<void> => {
    ctx.exit();
  },
});

registerCommand({
  name: "clear",
  description: "Clear all history and start a new session",
  handler: async (_args, ctx): Promise<void> => {
    ctx.agent.clearSession();
    ctx.agent.setTokenCount(0);
    const newSession = `session-${Date.now()}`;
    const newLogger = await createLogger(
      MessageStore.getProjectHash(),
      newSession,
    );
    ctx.agent.setSession(newSession);
    ctx.agent.setLogger(newLogger);
    ctx.setCurrentSession(newSession);
    ctx.agent
      .getStore()
      .addStatus({
        role: "status",
        content: "(Cleared)",
        timestamp: new Date(),
      });
  },
});

registerCommand({
  name: "compress",
  description: "Compress conversation history",
  handler: async (_args, ctx): Promise<void> => {
    await ctx.agent.compress();
    ctx.agent
      .getStore()
      .addStatus({
        role: "status",
        content: "(Compression complete)",
        timestamp: new Date(),
      });
  },
});

registerCommand({
  name: "effort",
  description: "Set thinking effort (low|medium|high|xhigh|max)",
  handler: async (args, ctx): Promise<void> => {
    const value = args[0]?.toLowerCase();
    const valid = ["low", "medium", "high", "xhigh", "max"] as const;
    if (!value || !(valid as readonly string[]).includes(value)) {
      // Show effort selection UI
      ctx.setInputMode("effort-select");
      return;
    }
    ctx.agent.setEffort(value as EffortLevel);
    const { setEffort } = await import("../config.js");
    await setEffort(value);
    ctx.agent.getStore().addStatus({
      role: "status",
      content: `(Effort set to: ${value})`,
      timestamp: new Date(),
    });
  },
});

registerCommand({
  name: "new",
  description: "Create a new session",
  handler: async (args, ctx): Promise<void> => {
    const name = args.join(" ");
    if (name) {
      ctx.agent.clearSession();
      const newLogger = await createLogger(
        MessageStore.getProjectHash(),
        name,
      );
      ctx.agent.setSession(name);
      ctx.agent.setLogger(newLogger);
      ctx.setCurrentSession(name);
      ctx.agent
        .getStore()
        .addStatus({
          role: "status",
          content: `Created session: ${name}`,
          timestamp: new Date(),
        });
    }
  },
});

registerCommand({
  name: "rename",
  description: "Rename current session",
  handler: async (args, ctx): Promise<void> => {
    const newName = args.join(" ");
    if (newName) {
      const oldName = ctx.agent.currentSession;
      await MessageStore.rename(oldName, newName);
      const newLogger = await createLogger(
        MessageStore.getProjectHash(),
        newName,
      );
      ctx.agent.setSession(newName);
      ctx.agent.setLogger(newLogger);
      ctx.setCurrentSession(newName);
      ctx.agent
        .getStore()
        .addStatus({
          role: "status",
          content: `Renamed: ${oldName} -> ${newName}`,
          timestamp: new Date(),
        });
    }
  },
});

registerCommand({
  name: "resume",
  description: "Load a session (without args: list sessions)",
  handler: async (args, ctx): Promise<void> => {
    if (args.length === 0) {
      const sessions = await MessageStore.list();
      ctx.setInputMode("session-list", { sessions });
    } else {
      const name = args[0];
      const data = await MessageStore.load(name);
      if (data) {
        ctx.agent.setMessages(data.messages as any);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          ctx.agent.setTokenCount(totalTokens);
        }
        const newLogger = await createLogger(
          MessageStore.getProjectHash(),
          name,
        );
        ctx.agent.setSession(name);
        ctx.agent.setLogger(newLogger);
        ctx.setCurrentSession(name);
        ctx.agent
          .getStore()
          .addStatus({
            role: "status",
            content: `Loaded session: ${name}`,
            timestamp: new Date(),
          });
      } else {
        ctx.agent
          .getStore()
          .addStatus({
            role: "error",
            content: `Session not found: ${name}`,
            timestamp: new Date(),
          });
      }
    }
  },
});

registerCommand({
  name: "plan",
  description: "Turn the current discussion into an executable plan",
  prompt: () => {
    return "Based on our discussion so far, produce a concrete, step-by-step executable plan. For each step, specify what to do and how to verify it works. Do NOT start implementing — only output the plan.";
  },
});

registerCommand({
  name: "test",
  description: "Run a simple test across all available tools",
  prompt: () => {
    return "Ignore the project context. Run a simple smoke test of your available tools, use each tool once with minimal inputs, and report pass/fail for each.";
  },
});

registerCommand({
  name: "skills",
  description: "List available skills",
  handler: async (_args, ctx): Promise<void> => {
    const skills = getAvailableSkills();
    if (skills.length === 0) {
      ctx.agent
        .getStore()
        .addStatus({
          role: "status",
          content: "(No skills available)",
          timestamp: new Date(),
        });
      return;
    }

    const { createElement: el } = await import("react");
    const { Box, Text } = await import("ink");

    const skillElements = skills.map((skill) =>
      el(
        Box,
        { key: skill.name, flexDirection: "row" },
        el(Box, { width: 25 }, el(Text, { color: "cyan" }, `  /${skill.name}`)),
        el(
          Box,
          { flexGrow: 1, flexShrink: 1 },
          el(
            Text,
            { wrap: "truncate", dimColor: true },
            `- ${skill.description}`,
          ),
        ),
      ),
    );

    const element = el(
      Box,
      { flexDirection: "column", paddingY: 1 },
      el(Text, { bold: true }, "Available skills:"),
      ...skillElements,
    );

    const lines = ["Available skills:"];
    for (const skill of skills) {
      lines.push(`  /${skill.name} - ${skill.description}`);
    }

    ctx.agent
      .getStore()
      .addStatus({
        role: "status",
        content: lines.join("\n"),
        element,
        timestamp: new Date(),
      });
  },
});

registerCommand({
  name: "model",
  description: "Switch model/provider",
  handler: async (_args, ctx): Promise<void> => {
    const { loadConfig } = await import("../config.js");
    const config = await loadConfig();
    const providers = config.providers ?? {};
    const tiers = config.tiers ?? {};
    ctx.setInputMode("model-select", { providers, tiers });
  },
});
