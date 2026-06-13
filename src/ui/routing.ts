import type { CommandContext } from "./commands/index.js";
import { executeCommand } from "./commands/index.js";

export interface RouteResult {
  action: "none" | "shell" | "command" | "llm";
  promptText?: string;
  displayContent?: string;
}

export interface InputHandler {
  matches(input: string): boolean;
  handle(
    input: string,
    cmdContext: CommandContext,
  ): Promise<RouteResult> | RouteResult;
}

const handlers: InputHandler[] = [];

export function registerInputHandler(handler: InputHandler): void {
  handlers.push(handler);
}

export function clearInputHandlers(): void {
  handlers.length = 0;
}

export function getInputHandlers(): readonly InputHandler[] {
  return handlers;
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
    if (result.handled && result.promptText) {
      return {
        action: "command",
        promptText: result.promptText,
        displayContent: result.displayContent,
      };
    }
    return { action: "command" };
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

// Register built-in handlers in priority order.
registerInputHandler(new ShellInputHandler());
registerInputHandler(new CommandInputHandler());
registerInputHandler(new LlmInputHandler());

export async function routeInput(
  input: string,
  cmdContext: CommandContext,
): Promise<RouteResult> {
  const trimmed = input.trim();
  if (!trimmed) return { action: "none" };

  for (const handler of handlers) {
    if (handler.matches(trimmed)) {
      return await handler.handle(trimmed, cmdContext);
    }
  }

  return { action: "llm", promptText: trimmed };
}
