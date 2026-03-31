export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { bashTool } from './bash.js';
export { agentTool } from './agent.js';
export { ToolRegistry } from './registry.js';

import React from 'react';
import type { AgentRegistry } from '../services/agent-registry.js';
import type { AgentConfig } from '../agent.js';

// Tool execution context - passed to tool execute
export interface ToolExecutionContext {
  registry?: AgentRegistry;
  config?: AgentConfig;
  currentAgentId?: string;
}

/** Tool returns output for LLM and ink element for TUI */
export interface ToolResult {
  output: string;
  display: React.ReactElement;
}

// ToolDef interface defined here for consistent imports
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  format?: (args: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>;
}
