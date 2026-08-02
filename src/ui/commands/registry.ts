/**
 * Command registry — a standalone module with no imports on other command
 * files. This avoids circular dependencies between index.ts and builtin/*.ts.
 * The registry is an explicit instance owned by the composition root, so
 * command registration is composition, not module-load side effects.
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

export class CommandRegistry {
  private commands = new Map<string, CommandHandler>();

  register(cmd: CommandHandler): void {
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
    this.commands.set(cmd.name, cmd);
  }

  get(name: string): CommandHandler | undefined {
    return this.commands.get(name);
  }

  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  getAll(): CommandHandler[] {
    return Array.from(this.commands.values());
  }

  /** Clear all registered commands (test isolation). */
  clear(): void {
    this.commands.clear();
  }
}
