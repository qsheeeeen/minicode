import type { AgentRegistry } from "../services/agent-registry.js";
import type { Model } from "../llm/model.js";
import type { UserPrompter } from "../utils/display.js";

export type ToolRequirement = "agentRegistry";

/** Narrow config passed to tools — only what tools actually need. */
export interface ToolConfig {
  model: Model;
  userPrompt: string;
}

export interface ToolExecutionContext {
  registry: AgentRegistry | undefined;
  config: ToolConfig;
  currentAgentId: string;
  signal: AbortSignal | undefined;
  prompter?: UserPrompter;
}

export interface ToolResult {
  output: string;
}

export interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (args: TArgs, context?: ToolExecutionContext) => Promise<ToolResult>;
  requires?: ToolRequirement[];
  requiresPermission?: boolean;
  readOnly?: boolean;
  interactive?: boolean;
  trackChanges?: boolean;
  changeOp?: "edit" | "write";
}

const defaultTools = new Map<string, ToolDef<any>>();

export function register(tool: ToolDef<any>): void {
  defaultTools.set(tool.name, tool);
}

export function getAll(): Map<string, ToolDef<any>> {
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

export function getSubAgentTools(): Map<string, ToolDef<any>> {
  const result = new Map<string, ToolDef<any>>();
  for (const [name, t] of defaultTools) {
    if ((t.readOnly ?? !t.requiresPermission) && !t.interactive) {
      result.set(name, t);
    }
  }
  return result;
}
