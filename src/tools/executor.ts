import type {
  ToolDef,
  ToolExecutionContext,
  ToolConfig,
  ToolRunResult,
  UserPrompter,
} from "./registry.js";
import type { LLMToolUseBlock } from "../llm/client.js";
import type { LLMContext } from "../llm/context.js";
import type { ChangeJournal } from "../services/change-journal.js";
import type { AgentRegistry } from "../services/agent-registry.js";
import type { AppConfig } from "../config.js";
import type { ShellService } from "../services/shell-service.js";
import {
  PermissionService,
  type PermissionMode,
} from "../services/permission.js";
import { callContent } from "../utils/tool-format.js";
import type pino from "pino";

export interface ToolCall {
  block: LLMToolUseBlock;
  tool?: ToolDef;
}

export interface ToolExecutorOpts {
  readonly tools: Map<string, ToolDef>;
  readonly permissionService: PermissionService;
  readonly context: LLMContext;
  readonly logger?: pino.Logger;
  // Stable execution environment — constant for the executor's lifetime.
  readonly registry?: AgentRegistry;
  readonly appConfig?: AppConfig;
  readonly currentAgentId?: string;
  readonly shell?: ShellService;
}

/** Per-invocation inputs that can change between execute() calls. */
export interface ToolExecutionDynamic {
  signal: AbortSignal;
  config: ToolConfig;
  prompter?: UserPrompter;
  activeUserMessageOrdinal?: number;
  changeJournal?: ChangeJournal;
}

/**
 * Executes tool calls with permission checks and error handling.
 * Decoupled from the Agent's core LLM loop.
 */
export class ToolExecutor {
  private tools: Map<string, ToolDef>;
  private permissionService: PermissionService;
  private context: LLMContext;
  private logger?: pino.Logger;
  private registry?: AgentRegistry;
  private appConfig?: AppConfig;
  private currentAgentId?: string;
  private shell?: ShellService;

  constructor(opts: ToolExecutorOpts) {
    this.tools = opts.tools;
    this.permissionService = opts.permissionService;
    this.context = opts.context;
    this.logger = opts.logger;
    this.registry = opts.registry;
    this.appConfig = opts.appConfig;
    this.currentAgentId = opts.currentAgentId;
    this.shell = opts.shell;
  }

  /**
   * Run a single tool with permission check and change tracking.
   */
  private async runTool(
    tool: ToolDef,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolRunResult> {
    if (!(tool.readOnly ?? !tool.requiresPermission)) {
      const displayText = callContent(tool.name, args);
      const { allowed, reason } = await this.permissionService.check(
        tool.name,
        args,
        displayText,
        context?.prompter,
      );
      if (!allowed) {
        if (this.permissionService.getMode() === "auto") {
          return {
            success: true,
            result: `Tool execution denied by auto-gate: ${reason || "unknown reason"}`,
          };
        }
        return {
          success: false,
          reason: reason || "User rejected",
        };
      }
    }

    return tool.execute(args, context);
  }

  /**
   * Execute tool calls sequentially and push tool_result blocks.
   */
  async execute(
    toolCalls: ToolCall[],
    dynamic: ToolExecutionDynamic,
  ): Promise<ToolRunResult | null> {
    if (toolCalls.length === 0) return null;

    const context: ToolExecutionContext = {
      registry: this.registry,
      appConfig: this.appConfig,
      currentAgentId: this.currentAgentId ?? "1",
      shell: this.shell,
      signal: dynamic.signal,
      config: dynamic.config,
      prompter: dynamic.prompter,
      activeUserMessageOrdinal: dynamic.activeUserMessageOrdinal,
      changeJournal: dynamic.changeJournal,
    };

    this.logger?.info(
      {
        session: context.config.model.getName(),
        toolCount: toolCalls.length,
        tools: toolCalls.map((t) => t.block.name),
      },
      "Executing tools sequentially",
    );

    const results: Array<{ toolUseId: string; content: string }> = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const { block, tool } = toolCalls[i];
      if (!tool) {
        results.push({
          toolUseId: block.id,
          content: `Error: Tool '${block.name}' not found or not available.`,
        });
        this.logger?.warn(
          { toolName: block.name },
          "LLM attempted to use an unavailable tool",
        );
        continue;
      }
      // Mark this tool and every remaining tool in the batch as denied,
      // flush their results, then surface the denial (no throw).
      const deny = (reason: string): ToolRunResult => {
        results.push({ toolUseId: block.id, content: reason });
        for (let j = i + 1; j < toolCalls.length; j++) {
          results.push({
            toolUseId: toolCalls[j].block.id,
            content: reason,
          });
        }
        for (const result of results) {
          this.context.completeToolCall(result.toolUseId, result.content);
        }
        return { success: false };
      };
      try {
        const result = await this.runTool(
          tool,
          block.input as Record<string, unknown>,
          context,
        );
        if (!result.success) {
          return deny(result.reason ?? "Denied");
        }
        results.push({ toolUseId: block.id, content: result.result ?? "" });
        this.logger?.info(
          { toolName: tool.name, toolInput: block.input },
          "Tool result",
        );
      } catch (reason) {
        const error = `Error: ${reason instanceof Error ? reason.message : String(reason)}`;
        results.push({ toolUseId: block.id, content: error });
        this.logger?.error(
          { toolName: tool.name, error: String(reason) },
          "Tool error",
        );
      }
    }

    for (const result of results) {
      this.context.completeToolCall(result.toolUseId, result.content);
    }
    return null;
  }

  // -- Accessors for Agent to use in the LLM loop --

  getTools(): Map<string, ToolDef> {
    return this.tools;
  }

  getPermissionService(): PermissionService {
    return this.permissionService;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionService.setMode(mode);
  }
}
