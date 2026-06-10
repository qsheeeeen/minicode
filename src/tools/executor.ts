import type { ToolDef, ToolExecutionContext } from "./registry.js";
import { ToolDeniedError } from "./registry.js";
import type { ToolUseBlock } from "../messages.js";
import type { MessageStore } from "../messages.js";
import type { ChangeJournal } from "../services/change-journal.js";
import {
  PermissionService,
  type PermissionMode,
} from "../services/permission.js";
import type { UserPrompter } from "../utils/display.js";
import { callContent } from "../utils/tool-format.js";
import type pino from "pino";

export interface ToolCall {
  block: ToolUseBlock;
  tool?: ToolDef;
}

export interface ToolExecutorDeps {
  tools: Map<string, ToolDef>;
  permissionService: PermissionService;
  changeJournal: ChangeJournal;
  store: MessageStore;
  logger?: pino.Logger;
}

/**
 * Executes tool calls with permission checks, change journaling,
 * and error handling. Decoupled from the Agent's core LLM loop.
 */
export class ToolExecutor {
  constructor(private deps: ToolExecutorDeps) {}

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
      const { allowed, reason } = await this.deps.permissionService.check(
        tool.name,
        args,
        displayText,
      );
      if (!allowed) {
        if (this.deps.permissionService.getMode() === "auto") {
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
      this.deps.changeJournal.recordBefore(
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

    this.deps.logger?.info(
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
        this.deps.logger?.warn(
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
        this.deps.logger?.info(
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
          this.deps.store.addToolResults(results);
          throw reason;
        }
        const error = `Error: ${reason instanceof Error ? reason.message : String(reason)}`;
        results.push({ toolUseId: block.id, content: error });
        this.deps.logger?.error(
          { toolName: tool.name, error: String(reason) },
          "Tool error",
        );
      }
    }

    // Push all tool results as a single user turn
    this.deps.store.addToolResults(results);
  }

  // -- Accessors for Agent to use in the LLM loop --

  getTools(): Map<string, ToolDef> {
    return this.deps.tools;
  }

  getPermissionService(): PermissionService {
    return this.deps.permissionService;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.deps.permissionService.setMode(mode);
  }

  setPrompter(prompter: UserPrompter): void {
    this.deps.permissionService.setPrompter(prompter);
  }
}
