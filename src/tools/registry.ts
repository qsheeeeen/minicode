import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { AppConfig } from "../config.js";

export interface PromptOption {
  label: string;
  value: string;
  description?: string;
}

export interface Prompt {
  message: string;
  options: PromptOption[];
  multiSelect?: boolean;
}

/** Agent asks, human answers (resolved via the injected prompter). */
export interface UserPrompter {
  prompt(req: Prompt): Promise<string>;
}

export type ToolRequirement = "agentRegistry";

export interface ToolConfig {
  client: LLMClient;
  model: Model;
  userPrompt: string;
}

/** Typed lookup key for a service a tool needs (shell, registry, …). */
export type Capability<T> = { readonly key: string; readonly _t?: T };
export function capability<T>(key: string): Capability<T> {
  return { key };
}

/** Capability → service map. App populates it; tools read. Adding a service
 *  never changes this interface. */
export interface Capabilities {
  get<T>(capability: Capability<T>): T | undefined;
}

export function createCapabilities(
  entries: ReadonlyArray<[Capability<unknown>, unknown]>,
): Capabilities {
  const map = new Map<string, unknown>(
    entries.map(([cap, value]) => [cap.key, value]),
  );
  return {
    get: <T>(capability: Capability<T>) =>
      map.get(capability.key) as T | undefined,
  };
}

export interface ToolExecutionContext {
  config: ToolConfig;
  appConfig?: AppConfig;
  currentAgentId: string;
  signal: AbortSignal | undefined;
  activeUserMessageOrdinal?: number;
  prompter?: UserPrompter;
  capabilities: Capabilities;
}

/**
 * Tool result, discriminated on `outcome`:
 * - success: result written back, batch continues.
 * - error:   reason written back, batch continues (soft).
 * - denied:  deny aborts the batch.
 */
export type ToolRunResult =
  | { outcome: "success"; result: string }
  | { outcome: "error"; reason: string }
  | { outcome: "denied"; reason: string };

export interface SubAgentSpawnParams {
  task: string;
  agentType: string;
  parent: ToolExecutionContext;
}
export type SubAgentSpawner = (
  params: SubAgentSpawnParams,
) => Promise<ToolRunResult>;

export interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (args: TArgs, context?: ToolExecutionContext) => Promise<ToolRunResult>;
  requires?: ToolRequirement[];
  requiresPermission?: boolean;
  readOnly?: boolean;
  interactive?: boolean;
}

const defaultTools = new Map<string, ToolDef<any>>();

export function register(tool: ToolDef<any>): void {
  defaultTools.set(tool.name, tool);
}

export function getAll(): Map<string, ToolDef<any>> {
  return new Map(defaultTools);
}

/** Tool-set for a sub-agent. readOnly (default): read-only only; false: all
 *  non-interactive; allowlist: explicit names (wins). Interactive tools and
 *  SubAgent itself are always excluded. */
export function getSubAgentTools(opts?: {
  readOnly?: boolean;
  allowlist?: string[];
}): Map<string, ToolDef<any>> {
  const readOnly = opts?.readOnly ?? true;
  const allowlist = opts?.allowlist;
  const result = new Map<string, ToolDef<any>>();
  for (const [name, t] of defaultTools) {
    if (t.interactive) continue;
    if (name === "SubAgent") continue;
    if (allowlist) {
      if (allowlist.includes(name)) result.set(name, t);
      continue;
    }
    if (readOnly && !(t.readOnly ?? !t.requiresPermission)) continue;
    result.set(name, t);
  }
  return result;
}
