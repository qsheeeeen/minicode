import type { CommandContext } from "./commands/index.js";
import { executeCommand } from "./commands/index.js";

export interface RouteResult {
  action: "none" | "shell" | "command" | "llm";
  promptText?: string;
  displayContent?: string;
  /** The command name for action:"command" (used in unknown-command errors). */
  command?: string;
}

export interface InputHandler {
  matches(input: string): boolean;
  handle(
    input: string,
    cmdContext: CommandContext,
  ): Promise<RouteResult> | RouteResult;
}

/**
 * InputRouter — explicit instance routing user input to shell / command /
 * LLM handlers. Owned by the composition root (one per app) instead of a
 * module-level handler list.
 */
export class InputRouter {
  private handlers: InputHandler[] = [];

  register(handler: InputHandler): void {
    this.handlers.push(handler);
  }

  clear(): void {
    this.handlers.length = 0;
  }

  getHandlers(): readonly InputHandler[] {
    return this.handlers;
  }

  async route(input: string, cmdContext: CommandContext): Promise<RouteResult> {
    const trimmed = input.trim();
    if (!trimmed) return { action: "none" };

    for (const handler of this.handlers) {
      if (handler.matches(trimmed)) {
        return await handler.handle(trimmed, cmdContext);
      }
    }

    return { action: "llm", promptText: trimmed };
  }
}

// ── Built-in handlers ──────────────────────────────────────────────────────

class ShellInputHandler implements InputHandler {
  matches(input: string): boolean {
    return input.startsWith("!");
  }

  handle(input: string): RouteResult {
    const cmd = input.slice(1).trim();
    if (!cmd) return { action: "none" };
    return { action: "shell", promptText: cmd };
  }
}

class CommandInputHandler implements InputHandler {
  matches(input: string): boolean {
    return input.startsWith("/");
  }

  async handle(
    input: string,
    cmdContext: CommandContext,
  ): Promise<RouteResult> {
    const parts = input.slice(1).split(/\s+/);
    const result = await executeCommand(parts[0], parts.slice(1), cmdContext);
    if (result.promptText) {
      return {
        action: "command",
        promptText: result.promptText,
        displayContent: result.displayContent,
      };
    }
    // Handled without a prompt (handler command) is done; unhandled is
    // unknown — route-handler reports it.
    return result.handled ? { action: "none" } : { action: "command", command: parts[0] };
  }
}

class LlmInputHandler implements InputHandler {
  matches(): boolean {
    return true;
  }

  handle(input: string): RouteResult {
    return { action: "llm", promptText: input };
  }
}

/** Default router with built-in handlers in priority order. */
export function createDefaultRouter(): InputRouter {
  const router = new InputRouter();
  router.register(new ShellInputHandler());
  router.register(new CommandInputHandler());
  router.register(new LlmInputHandler());
  return router;
}
