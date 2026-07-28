// Shared test utilities.
//
// Re-usable helpers for creating test doubles (virtual tools, etc).
// Test files import directly from here instead of polluting production modules.

import type { ToolDef, ToolRunResult } from "../tools/registry.js";

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
    execute: async (args: Record<string, unknown>): Promise<ToolRunResult> => {
      const output = await handler(args);
      return { outcome: "success", result: output };
    },
  };
}

/** Assert a success outcome and return its result text. */
export function unwrapSuccess(r: ToolRunResult): string {
  if (r.outcome !== "success")
    throw new Error(`expected success outcome, got ${r.outcome}`);
  return r.result;
}

/** Assert an error outcome and return its reason text. */
export function unwrapError(r: ToolRunResult): string {
  if (r.outcome !== "error")
    throw new Error(`expected error outcome, got ${r.outcome}`);
  return r.reason;
}
