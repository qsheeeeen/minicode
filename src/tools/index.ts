export { ToolRegistry } from "./registry.js";

import type { AgentRegistry } from "../services/agent-registry.js";
import type { AgentConfig } from "../agent.js";
import type { PermissionService } from "../services/permission.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { agentTool } from "./sub_agent.js";
import { activateSkillTool } from "./activate_skill.js";
import { askUserTool } from "./ask_user.js";
import { setModelTool } from "./set_model.js";
import { ToolRegistry } from "./registry.js";

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
import type { SkillRegistry } from "../skills/index.js";
import type { UserPrompter } from "../utils/display.js";

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

export type ToolRequirement = "agentRegistry" | "skillRegistry";

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
}

export interface ToolAvailability {
  agentRegistry?: AgentRegistry;
  skillRegistry?: SkillRegistry;
}

export const allTools: ToolDef[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  agentTool,
  activateSkillTool,
  askUserTool,
  setModelTool,
];

export function registerTools(
  registry: ToolRegistry,
  availability: ToolAvailability,
  excludeTools: string[] = [],
): void {
  for (const tool of allTools) {
    if (excludeTools.includes(tool.name)) continue;
    if (tool.requires?.some((r) => !availability[r])) continue;
    registry.register(tool);
  }
}
