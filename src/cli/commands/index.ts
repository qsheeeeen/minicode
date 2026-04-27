import type { Agent } from '../../agent.js';
import type { SessionManager } from '../../utils/session.js';
import type { DisplayMessage } from '../../utils/display.js';

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
  sessionManager: SessionManager;
  setMessages: (msg: DisplayMessage[] | ((prev: DisplayMessage[]) => DisplayMessage[])) => void;
  setCurrentSession: (name: string) => void;
  setMode: (mode: 'chat' | 'session-list' | 'effort-select') => void;
  setSessionList: (sessions: Array<{ name: string }>) => void;
  setSelectedIndex: (index: number) => void;
  exit: () => void;
}

class CommandRegistry {
  private commands = new Map<string, CommandHandler>();

  register(cmd: CommandHandler): void {
    if (!cmd.handler && !cmd.prompt) {
      throw new Error(`Command "${cmd.name}" must have either handler or prompt`);
    }
    if (cmd.handler && cmd.prompt) {
      throw new Error(`Command "${cmd.name}" cannot have both handler and prompt`);
    }
    this.commands.set(cmd.name, cmd);
  }

  async parseAndExecute(input: string, context: CommandContext): Promise<{ handled: boolean; promptText?: string; displayContent?: string }> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return { handled: false };

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0];
    const args = parts.slice(1);

    const cmd = this.commands.get(name);
    if (cmd) {
      if (cmd.handler) {
        await cmd.handler(args, context);
        return { handled: true };
      }
      if (cmd.prompt) {
        return { handled: true, promptText: cmd.prompt(args), displayContent: `/${name}` };
      }
    }

    return { handled: false };
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  getCommandList(): Array<{ name: string; description: string }> {
    return Array.from(this.commands.values()).map(cmd => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  getHelp(): string {
    const lines = ['Available commands:'];
    for (const cmd of this.commands.values()) {
      lines.push(`  /${cmd.name} - ${cmd.description}`);
    }
    return lines.join('\n');
  }
}

export const commandRegistry = new CommandRegistry();
