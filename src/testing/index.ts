// Shared test utilities.
//
// Re-usable helpers for creating test doubles (virtual tools, etc).
// Test files import directly from here instead of polluting production modules.

import type { ToolDef, ToolResult } from "../tools/registry.js";

export {
  VirtualLLMClient,
  defaultTextResponse,
  toolUseResponse,
} from "./virtual-llm.js";
export type { ScriptedResponse, VirtualLLMOptions } from "./virtual-llm.js";

/**
 * Creates a virtual tool with a custom handler function.
 * The handler receives the raw args and returns a string output.
 */
export function createVirtualTool(
  name: string,
  handler: (args: Record<string, unknown>) => string | Promise<string>,
  options?: {
    description?: string;
    requiresPermission?: boolean;
    readOnly?: boolean;
  },
): ToolDef {
  return {
    name,
    description: options?.description ?? `Virtual tool: ${name}`,
    input_schema: { type: "object" as const, properties: {} },
    requiresPermission: options?.requiresPermission ?? false,
    readOnly: options?.readOnly ?? true,
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const output = await handler(args);
      return { output };
    },
  };
}
