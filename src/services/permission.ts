import type { LLMClient } from "../llm/client.js";
import type { LLMResponse } from "../llm/client.js";
import type { UserPrompter } from "../tools/registry.js";

export type PermissionMode = "manual" | "yolo" | "auto";

const MODES: PermissionMode[] = ["manual", "yolo", "auto"];

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface PermissionStrategy {
  check(
    toolName: string,
    toolInput: Record<string, unknown>,
    displayText: string,
    prompter?: UserPrompter,
  ): Promise<PermissionCheckResult>;
}

const strategies = new Map<PermissionMode, PermissionStrategy>();

export function registerPermissionStrategy(
  mode: PermissionMode,
  strategy: PermissionStrategy,
): void {
  strategies.set(mode, strategy);
}

export function getPermissionStrategy(mode: PermissionMode): PermissionStrategy | undefined {
  return strategies.get(mode);
}

// ── Built-in strategies ────────────────────────────────────────────────────

export class YoloPermissionStrategy implements PermissionStrategy {
  async check(): Promise<PermissionCheckResult> {
    return { allowed: true };
  }
}

export class ManualPermissionStrategy implements PermissionStrategy {
  async check(
    _toolName: string,
    _toolInput: Record<string, unknown>,
    displayText: string,
    prompter?: UserPrompter,
  ): Promise<PermissionCheckResult> {
    const answer = await prompter?.prompt({
      message: `Allow tool execution?\n${displayText}`,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        { label: "Yes to all", value: "yolo" },
      ],
    });
    if (!answer) return { allowed: false, reason: "User cancelled" };
    if (answer === "yolo") return { allowed: true, reason: "yolo" };
    if (answer === "yes") return { allowed: true };
    return { allowed: false, reason: "User rejected" };
  }
}

export class AutoPermissionStrategy implements PermissionStrategy {
  constructor(
    private readonly client?: LLMClient,
    private readonly model?: string,
  ) {}

  async check(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<PermissionCheckResult> {
    if (!this.client) {
      return {
        allowed: false,
        reason: "No LLM client configured for auto-permission",
      };
    }

    try {
      const prompt = `You are a permission gate for a coding agent. Decide if this tool execution should be allowed.

Tool: ${toolName}
Arguments: ${JSON.stringify(toolInput, null, 2)}

Guidelines:
- Read operations are always safe.
- Writing to files in /tmp or project directories is usually safe.
- Running commands that modify the system (apt-get, chmod, etc.) may be risky.
- Destructive commands (rm -rf /, mkfs, dd) should be denied.
- Network commands that download and execute code should be denied.

Reply with exactly one of:
- "yes"
- "no: <reason explaining why it was denied>"`;

      const stream = this.client.chatStream(
        [{ role: "user", content: prompt }],
        [],
        { model: this.model, maxTokens: 100 },
      );
      let response: LLMResponse | undefined;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          response = next.value as LLMResponse;
          break;
        }
      }
      const text =
        response?.content[0]?.type === "text"
          ? response.content[0].text.trim()
          : "no: unknown error";

      if (text.toLowerCase().startsWith("yes")) {
        return { allowed: true };
      }

      const reason = text.toLowerCase().startsWith("no:")
        ? text.slice(3).trim()
        : text;

      return { allowed: false, reason: reason || "Denied by auto-gate" };
    } catch (e) {
      return {
        allowed: false,
        reason: `Error during auto-permission check: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

// Register built-in strategies
registerPermissionStrategy("yolo", new YoloPermissionStrategy());
registerPermissionStrategy("manual", new ManualPermissionStrategy());

export class PermissionService {
  private mode: PermissionMode;

  constructor(
    initialMode: PermissionMode,
    client?: LLMClient,
    model?: string,
  ) {
    this.mode = initialMode;
    // Ensure auto strategy is registered with the provided client/model.
    if (!strategies.has("auto")) {
      registerPermissionStrategy("auto", new AutoPermissionStrategy(client, model));
    }
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  cycleMode(): PermissionMode {
    const idx = MODES.indexOf(this.mode);
    this.mode = MODES[(idx + 1) % MODES.length];
    return this.mode;
  }

  async check(
    toolName: string,
    toolInput: Record<string, unknown>,
    displayText: string,
    prompter?: UserPrompter,
  ): Promise<PermissionCheckResult> {
    const strategy = strategies.get(this.mode);
    if (!strategy) {
      return { allowed: false, reason: `Unknown permission mode: ${this.mode}` };
    }
    return strategy.check(toolName, toolInput, displayText, prompter);
  }
}
