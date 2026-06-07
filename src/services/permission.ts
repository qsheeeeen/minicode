import type { LLMClient } from "../llm/client.js";
import type { UserPrompter } from "../utils/display.js";

export type PermissionMode = "manual" | "yolo" | "auto";

const MODES: PermissionMode[] = ["manual", "yolo", "auto"];

export class PermissionService {
  private mode: PermissionMode;
  private client?: LLMClient;
  private model?: string;
  private prompter?: UserPrompter;

  constructor(options: {
    initialMode: PermissionMode;
    client?: LLMClient;
    model?: string;
  }) {
    this.mode = options.initialMode;
    this.client = options.client;
    this.model = options.model;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  setPrompter(prompter: UserPrompter): void {
    this.prompter = prompter;
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
  ): Promise<{ allowed: boolean; reason?: string }> {
    switch (this.mode) {
      case "yolo":
        return { allowed: true };
      case "manual": {
        const answer = await this.prompter?.prompt({
          message: `Allow tool execution?\n${displayText}`,
          options: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
            { label: "Yes to all", value: "yolo" },
          ],
        });
        if (!answer) return { allowed: false, reason: "User cancelled" }; // empty = cancelled via Esc/Ctrl+C
        if (answer === "yolo") {
          this.setMode("yolo");
          return { allowed: true };
        }
        if (answer === "yes") return { allowed: true };
        return { allowed: false, reason: "User rejected" };
      }
      case "auto":
        return this.autoDecide(toolName, toolInput);
    }
  }

  private async autoDecide(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.client)
      return {
        allowed: false,
        reason: "No LLM client configured for auto-permission",
      };

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
      const text = response?.content[0]?.type === "text" ? response.content[0].text.trim() : "no: unknown error";

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
