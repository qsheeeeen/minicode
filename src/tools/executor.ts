import type { ToolDef, ToolExecutionContext } from "./registry.js";
import { ToolDeniedError } from "./registry.js";
import type { LLMToolUseBlock } from "../llm/client.js";
import type { LLMHistory } from "../llm/history.js";
import type { ChangeJournal } from "../services/change-journal.js";
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
  readonly getChangeJournal: () => ChangeJournal;
  readonly context: LLMHistory;
  readonly logger?: pino.Logger;
}

/**
 * Executes tool calls with permission checks, change journaling,
 * and error handling. Decoupled from the Agent's core LLM loop.
 */
export class ToolExecutor {
  private tools: Map<string, ToolDef>;
  private permissionService: PermissionService;
  private getChangeJournal: () => ChangeJournal;
  private context: LLMHistory;
  private logger?: pino.Logger;

  constructor(opts: ToolExecutorOpts) {
    this.tools = opts.tools;
    this.permissionService = opts.permissionService;
    this.getChangeJournal = opts.getChangeJournal;
    this.context = opts.context;
    this.logger = opts.logger;
  }

  /**
   * Run a single tool with permission check and change tracking.
   */
  private async runTool(
    tool: ToolDef,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    activeTurnIdx: number,
  ): Promise<{ output: string }> {
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
            output: `Tool execution denied by auto-gate: ${reason || "unknown reason"}`,
          };
        }
        throw new ToolDeniedError(tool.name, displayText, reason);
      }
    }

    if (tool.trackChanges && args.path && activeTurnIdx > 0) {
      const filePath = args.path as string;
      let before = "";
      try {
        const fs = await import("fs/promises");
        before = await fs.readFile(filePath, "utf-8");
      } catch {
        // File doesn't exist yet — before stays ""
      }
      this.getChangeJournal().recordBefore(
        activeTurnIdx,
        filePath,
        tool.changeOp ?? "write",
        before,
      );
    }

    return tool.execute(args, context);
  }

  /**
   * Execute tool calls sequentially and push tool_result turns.
   */
  async execute(
    toolCalls: ToolCall[],
    context: ToolExecutionContext,
    activeTurnIdx: number,
  ): Promise<void> {
    if (toolCalls.length === 0) return;

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
      try {
        const result = await this.runTool(
          tool,
          block.input as Record<string, unknown>,
          context,
          activeTurnIdx,
        );
        results.push({ toolUseId: block.id, content: result.output });
        this.logger?.info(
          { toolName: tool.name, toolInput: block.input },
          "Tool result",
        );
      } catch (reason) {
        if (reason instanceof ToolDeniedError) {
          results.push({ toolUseId: block.id, content: reason.reason });
          for (let j = i + 1; j < toolCalls.length; j++) {
            results.push({
              toolUseId: toolCalls[j].block.id,
              content: reason.reason,
            });
          }
          for (const result of results) {
            this.context.completeToolCall(result.toolUseId, result.content);
          }
          throw reason;
        }
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
