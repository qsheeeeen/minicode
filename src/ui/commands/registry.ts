/**
 * Command registry — a standalone module with no imports on other command files.
 * This avoids circular dependencies between index.ts and builtin/*.ts.
 */

export interface CommandHandler {
  name: string;
  description: string;
  // System command: directly manipulates app state
  handler?: (
    args: string[],
    context: import("./index.js").CommandContext,
  ) => Promise<void>;
  // Prompt command: returns text to inject into agent conversation
  prompt?: (args: string[]) => string;
}

const commands = new Map<string, CommandHandler>();

export function registerCommand(cmd: CommandHandler): void {
  if (!cmd.handler && !cmd.prompt) {
    throw new Error(`Command "${cmd.name}" must have either handler or prompt`);
  }
  if (cmd.handler && cmd.prompt) {
    throw new Error(
      `Command "${cmd.name}" cannot have both handler and prompt`,
    );
  }
  commands.set(cmd.name, cmd);
}

export function getCommand(name: string): CommandHandler | undefined {
  return commands.get(name);
}

export function getCommandNames(): string[] {
  return Array.from(commands.keys());
}

export function getAllCommands(): CommandHandler[] {
  return Array.from(commands.values());
}

/** Clear all registered commands (test isolation). */
export function resetCommands(): void {
  commands.clear();
}
