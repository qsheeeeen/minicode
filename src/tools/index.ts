export { ToolRegistry } from './registry.js';

import React from 'react';
import type { AgentRegistry } from '../services/agent-registry.js';
import type { AgentConfig } from '../agent.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { agentTool } from './agent.js';
import { ToolRegistry } from './registry.js';

// Tool execution context - passed to tool execute
export interface ToolDisplayHandle {
  update(element: React.ReactElement): void;
}

export interface ToolExecutionContext {
  registry?: AgentRegistry;
  config?: AgentConfig;
  currentAgentId?: string;
  display?: ToolDisplayHandle;
}

/** Tool returns output for LLM and ink element for TUI */
export interface ToolResult {
  output: string;
  display: React.ReactElement;
}

// ToolDef interface defined here for consistent imports
export type ToolRequirement = 'agentRegistry';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  format?: (args: Record<string, unknown>) => React.ReactElement;
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>;
  requires?: ToolRequirement[];
}

export interface ToolAvailability {
  agentRegistry?: AgentRegistry;
}

export const allTools: ToolDef[] = [readTool, writeTool, editTool, bashTool, agentTool];

export function registerTools(
  registry: ToolRegistry,
  availability: ToolAvailability,
  excludeTools: string[] = []
): void {
  for (const tool of allTools) {
    if (excludeTools.includes(tool.name)) continue;
    if (tool.requires?.some(r => !availability[r])) continue;
    registry.register(tool);
  }
}
