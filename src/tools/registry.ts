import type { AgentRegistry } from "../services/agent-registry.js";
import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type { AppConfig } from "../config.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { ShellService } from "../services/shell-service.js";
import type { ChangeJournal } from "../services/change-journal.js";

/**
 * UI interaction interfaces defined by the tool execution layer.
 * Tools that need user interaction (e.g., AskUser, PermissionService)
 * use UserPrompter to request input without knowing about the UI implementation.
 */
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

/** Request-response: agent asks, human answers. */
export interface UserPrompter {
  prompt(req: Prompt): Promise<string>;
}

export type ToolRequirement = "agentRegistry";

/** Narrow config passed to tools — only what tools actually need. */
export interface ToolConfig {
  client: LLMClient;
  model: Model;
  userPrompt: string;
}

export interface ToolExecutionContext {
  registry: AgentRegistry | undefined;
  config: ToolConfig;
  appConfig: AppConfig;
  currentAgentId: string;
  signal: AbortSignal | undefined;
  changeJournal?: ChangeJournal;
  activeUserMessageOrdinal?: number;
  prompter?: UserPrompter;
  services?: {
    modelSwitcher?: ModelSwitchService;
    shell?: ShellService;
  };
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
