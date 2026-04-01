import type { Agent } from '../agent.js';
import type { SessionManager } from '../utils/session.js';
import type { DisplayMessage } from '../utils/display.js';

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
  setMode: (mode: 'chat' | 'session-list') => void;
  setSessionList: (sessions: Array<{ name: string }>) => void;
  setSelectedIndex: (index: number) => void;
  exit: () => void;
}

export class CommandRegistry {
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

  async parseAndExecute(input: string, context: CommandContext): Promise<{ handled: boolean; promptText?: string }> {
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
        return { handled: true, promptText: cmd.prompt(args) };
      }
    }

    return { handled: false };
  }

  getHelp(): string {
    const lines = ['Available commands:'];
    for (const cmd of this.commands.values()) {
      lines.push(`  /${cmd.name} - ${cmd.description}`);
    }
    return lines.join('\n');
  }
}

// Built-in commands
export const commandRegistry = new CommandRegistry();

commandRegistry.register({
  name: 'exit',
  description: 'Exit the application',
  handler: async (_args, ctx): Promise<void> => {
    ctx.exit();
  }
});

commandRegistry.register({
  name: 'compress',
  description: 'Compress conversation history',
  handler: async (_args, ctx): Promise<void> => {
    await ctx.agent.compress();
    ctx.setMessages([{ role: 'system', content: '(Compression complete)', timestamp: new Date() }]);
  }
});

commandRegistry.register({
  name: 'new',
  description: 'Create a new session',
  handler: async (args, ctx): Promise<void> => {
    const name = args.join(' ');
    if (name) {
      ctx.agent.clearSession();
      ctx.agent.currentSession = name;
      ctx.setCurrentSession(name);
      ctx.setMessages([{ role: 'system', content: `Created session: ${name}`, timestamp: new Date() }]);
    }
  }
});

commandRegistry.register({
  name: 'rename',
  description: 'Rename current session',
  handler: async (args, ctx): Promise<void> => {
    const newName = args.join(' ');
    if (newName) {
      const oldName = ctx.agent.currentSession;
      await ctx.sessionManager.rename(oldName, newName);
      ctx.agent.currentSession = newName;
      ctx.setCurrentSession(newName);
      ctx.setMessages(prev => [...prev, { role: 'system', content: `Renamed: ${oldName} -> ${newName}`, timestamp: new Date() }]);
    }
  }
});

commandRegistry.register({
  name: 'resume',
  description: 'Load a session (without args: list sessions)',
  handler: async (args, ctx): Promise<void> => {
    if (args.length === 0) {
      // List sessions
      const sessions = await ctx.sessionManager.list();
      ctx.setSessionList(sessions.map(s => ({ name: s.name })));
      ctx.setSelectedIndex(0);
      ctx.setMode('session-list');
    } else {
      // Load specific session
      const name = args[0];
      const data = await ctx.sessionManager.get(name);
      if (data) {
        ctx.agent.setMessages(data.messages as any);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          ctx.agent.setTokenCount(totalTokens);
        }
        ctx.agent.currentSession = name;
        ctx.setCurrentSession(name);
        const { SessionDisplayImpl } = await import('../utils/session-display.js');
        const sessionDisplay = new SessionDisplayImpl(ctx.sessionManager, ctx.agent.getToolRegistry());
        const displayMessages = await sessionDisplay.loadForTUI(name);
        ctx.setMessages(displayMessages.length > 0 ? displayMessages: [{ role: 'system', content: `Loaded session: ${name}`, timestamp: new Date() }]);
      } else {
        ctx.setMessages(prev => [...prev, { role: 'error', content: `Session not found: ${name}`, timestamp: new Date() }]);
      }
    }
  }
});

commandRegistry.register({
  name: 'plan',
  description: 'Turn the current discussion into an executable plan',
  prompt: () => {
    return 'Based on our discussion so far, produce a concrete, step-by-step executable plan. For each step, specify what to do and how to verify it works. Do NOT start implementing — only output the plan.';
  }
});
