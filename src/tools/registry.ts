import type { AgentRegistry } from "#src/services/agent-registry.js";
import type { AgentConfig } from "#src/agent.js";
import type { PermissionService } from "#src/services/permission.js";
import type { UserPrompter } from "#src/utils/display.js";

export type ToolRequirement = "agentRegistry";

export interface ToolExecutionContext {
  registry?: AgentRegistry;
  config?: AgentConfig;
  currentAgentId?: string;
  signal?: AbortSignal;
  permissionService?: PermissionService;
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

const defaultTools = new Map<string, ToolDef>();

export function register(tool: ToolDef): void {
  defaultTools.set(tool.name, tool);
}

export function getAll(): Map<string, ToolDef> {
  return new Map(defaultTools);
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

export function getSubAgentTools(): Map<string, ToolDef> {
  const result = new Map<string, ToolDef>();
  for (const [name, t] of defaultTools) {
    if ((t.readOnly ?? !t.requiresPermission) && !t.interactive) {
      result.set(name, t);
    }
  }
  return result;
}
