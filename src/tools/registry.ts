import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { AppConfig } from "../config.js";

import type { UserPrompter } from "../core/prompt.js";
export type { PromptOption, Prompt, UserPrompter } from "../core/prompt.js";

export type ToolRequirement = "agentRegistry" | "python3";

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
  /** Fail loudly (not silently undefined) when a required service is missing. */
  require<T>(capability: Capability<T>): T;
}

const LAZY = Symbol("capability-lazy");

/** Defer a capability value to read time — for handles the owner may swap
 *  (e.g. the change journal is recreated when a session is cleared). */
export function lazy<T>(factory: () => T): { [LAZY]: () => T } {
  return { [LAZY]: factory };
}

export function createCapabilities(
  entries: ReadonlyArray<
    [Capability<unknown>, unknown | { [LAZY]: () => unknown }]
  >,
): Capabilities {
  const map = new Map<string, unknown>();
  for (const [cap, value] of entries) {
    if (map.has(cap.key)) {
      throw new Error(`Duplicate capability registration: "${cap.key}"`);
    }
    map.set(cap.key, value);
  }
  const resolve = (value: unknown): unknown =>
    typeof value === "object" && value !== null && LAZY in value
      ? (value as { [LAZY]: () => unknown })[LAZY]()
      : value;
  return {
    get: <T>(capability: Capability<T>): T | undefined => {
      if (!map.has(capability.key)) return undefined;
      return resolve(map.get(capability.key)) as T;
    },
    require: <T>(capability: Capability<T>): T => {
      if (!map.has(capability.key)) {
        throw new Error(
          `Required capability not provided: "${capability.key}"`,
        );
      }
      return resolve(map.get(capability.key)) as T;
    },
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
  execute: (
    args: TArgs,
    context?: ToolExecutionContext,
  ) => Promise<ToolRunResult>;
  requires?: ToolRequirement[];
  requiresPermission?: boolean;
  readOnly?: boolean;
  interactive?: boolean;
}

/**
 * Extensible tool registry. The composition root owns one instance and
 * registers built-ins explicitly (registerBuiltinTools); tests can create
 * fresh instances instead of mutating process-wide singletons.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDef<any>>();

  register(tool: ToolDef<any>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef<any> | undefined {
    return this.tools.get(name);
  }

  getAll(): Map<string, ToolDef<any>> {
    return new Map(this.tools);
  }

  /** Tool-set for a sub-agent. readOnly (default): read-only only; false: all
   *  non-interactive; allowlist: explicit names (wins). Interactive tools and
   *  SubAgent itself are always excluded. */
  getSubAgentTools(opts?: {
    readOnly?: boolean;
    allowlist?: string[];
  }): Map<string, ToolDef<any>> {
    const readOnly = opts?.readOnly ?? true;
    const allowlist = opts?.allowlist;
    const result = new Map<string, ToolDef<any>>();
    for (const [name, t] of this.tools) {
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

  reset(): void {
    this.tools.clear();
  }
}
