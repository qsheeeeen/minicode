import type {
  ToolDef,
  ToolExecutionContext,
  ToolConfig,
  ToolRunResult,
  UserPrompter,
  Capabilities,
} from "./registry.js";
import type { LLMToolUseBlock } from "../llm/client.js";
import type { LLMContext } from "../llm/context.js";
import type { AppConfig } from "../config.js";
import { PermissionService } from "../services/permission.js";
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
  readonly appConfig?: AppConfig;
  readonly currentAgentId?: string;
  readonly capabilities: Capabilities;
}

/** Per-invocation inputs that can change between execute() calls. */
export interface ToolExecutionDynamic {
  signal: AbortSignal;
  config: ToolConfig;
  prompter?: UserPrompter;
  activeUserMessageOrdinal?: number;
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
  private appConfig?: AppConfig;
  private currentAgentId?: string;
  private capabilities: Capabilities;

  constructor(opts: ToolExecutorOpts) {
    this.tools = opts.tools;
    this.permissionService = opts.permissionService;
    this.context = opts.context;
    this.logger = opts.logger;
    this.appConfig = opts.appConfig;
    this.currentAgentId = opts.currentAgentId;
    this.capabilities = opts.capabilities;
  }

  /**
   * Execute tool calls and push tool_result blocks.
   *
   * Permission checks are serialized (prompts must never race); once every
   * tool is approved, executions run concurrently and results are written
   * back in the original tool_use order.
   */
  async execute(
    toolCalls: ToolCall[],
    dynamic: ToolExecutionDynamic,
  ): Promise<"denied" | null> {
    if (toolCalls.length === 0) return null;

    const context: ToolExecutionContext = {
      appConfig: this.appConfig,
      currentAgentId: this.currentAgentId ?? "1",
      signal: dynamic.signal,
      config: dynamic.config,
      prompter: dynamic.prompter,
      activeUserMessageOrdinal: dynamic.activeUserMessageOrdinal,
      capabilities: this.capabilities,
    };

    this.logger?.info(
      {
        session: context.config.model.getName(),
        toolCount: toolCalls.length,
        tools: toolCalls.map((t) => t.block.name),
      },
      "Executing tools",
    );

    // Phase 1 — permission checks, serialized so prompts never race.
    const approvals: Array<{ autoDenied?: string }> = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const { block, tool } = toolCalls[i];
      if (!tool) {
        approvals.push({});
        this.logger?.warn(
          { toolName: block.name },
          "LLM attempted to use an unavailable tool",
        );
        continue;
      }
      if (tool.readOnly ?? !tool.requiresPermission) {
        approvals.push({});
        continue;
      }

      const args = block.input as Record<string, unknown>;
      const { allowed, reason } = await this.permissionService.check(
        tool.name,
        args,
        callContent(tool.name, args),
        context.prompter,
      );
      if (!allowed) {
        if (this.permissionService.getMode() === "auto") {
          approvals.push({
            autoDenied: reason || "unknown reason",
          });
          continue;
        }
        // Hard denial: nothing runs, every tool_use in the batch gets the
        // denial so no tool_use is left without a tool_result.
        const denial = reason || "User rejected";
        for (const { block: b } of toolCalls) {
          this.context.completeToolCall(b.id, denial);
        }
        return "denied";
      }
      approvals.push({});
    }

    // Phase 2 — run approved tools concurrently, keep results in order.
    const results: Array<{ toolUseId: string; content: string }> = new Array(
      toolCalls.length,
    );
    let batchDenied = false;
    await Promise.all(
      toolCalls.map(async (call, i) => {
        const { block, tool } = call;
        let content: string;
        if (!tool) {
          content = `Error: Tool '${block.name}' not found or not available.`;
        } else if (approvals[i].autoDenied) {
          content = `Error: Tool execution denied by auto-gate: ${approvals[i].autoDenied}`;
        } else {
          try {
            const result = await tool.execute(
              block.input as Record<string, unknown>,
              context,
            );
            if (result.outcome === "denied") {
              content = result.reason;
              batchDenied = true;
            } else if (result.outcome === "error") {
              content = `Error: ${result.reason}`;
              this.logger?.info(
                { toolName: tool.name, error: result.reason },
                "Tool soft-failed",
              );
            } else {
              content = result.result;
            }
          } catch (reason) {
            content = `Error: ${reason instanceof Error ? reason.message : String(reason)}`;
            this.logger?.error(
              { toolName: tool.name, error: String(reason) },
              "Tool error",
            );
          }
        }
        results[i] = { toolUseId: block.id, content };
      }),
    );

    for (const result of results) {
      this.context.completeToolCall(result.toolUseId, result.content);
    }
    return batchDenied ? "denied" : null;
  }

  // -- Accessors for Agent to use in the LLM loop --

  getTools(): Map<string, ToolDef> {
    return this.tools;
  }
}
