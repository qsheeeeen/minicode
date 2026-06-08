// Test utilities for creating virtual LLM clients and tools.

import { VirtualLLMClient } from "../llm/virtual.js";
import type { ScriptedResponse } from "../llm/virtual.js";
import type { ToolDef, ToolResult } from "./registry.js";

export type { ScriptedResponse } from "../llm/virtual.js";
export { defaultTextResponse, toolUseResponse } from "../llm/virtual.js";

/**
 * Creates a virtual LLMClient that plays back scripted responses in order.
 */
export function createVirtualLLM(
  responses: ScriptedResponse[],
): VirtualLLMClient {
  return new VirtualLLMClient(responses);
}

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
