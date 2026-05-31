import type { AgentRegistry } from "../services/agent-registry.js";
import type { AgentConfig } from "../agent.js";
import type { PermissionService } from "../services/permission.js";
import type { SkillRegistry } from "../skills/index.js";
import type { UserPrompter } from "../utils/display.js";

export type ToolRequirement = "agentRegistry" | "skillRegistry";

export interface ToolExecutionContext {
  registry?: AgentRegistry;
  config?: AgentConfig;
  currentAgentId?: string;
  signal?: AbortSignal;
  permissionService?: PermissionService;
  skillRegistry?: SkillRegistry;
  prompter?: UserPrompter;
}

export interface ToolResult {
  output: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<ToolResult>;
  requires?: ToolRequirement[];
  requiresPermission?: boolean;
  readOnly?: boolean;
  interactive?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }
}

const defaultTools: ToolDef[] = [];

export function register(tool: ToolDef): void {
  defaultTools.push(tool);
}

export function all(): ToolDef[] {
  return [...defaultTools];
}

export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly displayText: string,
    public readonly reason: string = "User rejected",
  ) {
    super(`Tool execution denied: ${toolName} (${reason})`);
    this.name = "ToolDeniedError";
  }
}

export function subAgentTools(): ToolDef[] {
  return defaultTools.filter(
    (t) => (t.readOnly ?? !t.requiresPermission) && !t.interactive,
  );
}
