export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { bashTool } from './bash.js';
export { ToolRegistry, toolRegistry } from './registry.js';

// ToolDef interface defined here for consistent imports
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  format?: (args: any) => string;
  formatResult?: (result: string) => string;
  execute: (args: any) => Promise<string>;
}
