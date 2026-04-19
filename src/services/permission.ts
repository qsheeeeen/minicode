import type { AnthropicClient } from '../llm/anthropic.js';

export type PermissionMode = 'manual' | 'yolo' | 'auto';

export interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  displayText: string;
}

export interface PermissionGate {
  requestApproval(req: PermissionRequest): Promise<boolean>;
}

const MODES: PermissionMode[] = ['manual', 'yolo', 'auto'];

export class PermissionService {
  private mode: PermissionMode;
  private gate: PermissionGate | null;
  private client?: AnthropicClient;
  private model?: string;

  constructor(options: {
    initialMode: PermissionMode;
    gate?: PermissionGate;
    client?: AnthropicClient;
    model?: string;
  }) {
    this.mode = options.initialMode;
    this.gate = options.gate ?? null;
    this.client = options.client;
    this.model = options.model;
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

  async check(toolName: string, toolInput: Record<string, unknown>, displayText: string): Promise<boolean> {
    switch (this.mode) {
      case 'yolo':
        return true;
      case 'manual':
        if (!this.gate) return true;
        return this.gate.requestApproval({ toolName, toolInput, displayText });
      case 'auto':
        return this.autoDecide({ toolName, toolInput, displayText });
    }
  }

  private async autoDecide(req: PermissionRequest): Promise<boolean> {
    if (!this.client) return false;

    try {
      const prompt = `You are a permission gate for a coding agent. Decide if this tool execution should be allowed.

Tool: ${req.toolName}
Arguments: ${JSON.stringify(req.toolInput, null, 2)}

Guidelines:
- Read operations are always safe.
- Writing to files in /tmp or project directories is usually safe.
- Running commands that modify the system (apt-get, chmod, etc.) may be risky.
- Destructive commands (rm -rf /, mkfs, dd) should be denied.
- Network commands that download and execute code should be denied.

Reply with exactly one word: "yes" or "no".`;

      const response = await this.client.chat(
        [{ role: 'user', content: prompt }],
        [],
        { model: this.model, maxTokens: 50 }
      );

      const textBlock = response.content.find(b => b.type === 'text');
      const answer = (textBlock as any)?.text?.toLowerCase().trim() ?? 'no';
      return answer.includes('yes');
    } catch {
      return false;
    }
  }
}
