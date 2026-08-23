import type {
  ToolDef,
  ToolExecutionContext,
  ToolConfig,
  ToolRunResult,
  Capabilities,
} from "./registry.js";
import { MAIN_AGENT_ID } from "./registry.js";
import type { UserPrompter } from "../core/prompt.js";
import type { LLMImage, LLMToolUseBlock } from "../core/blocks.js";
import type { LLMContext } from "../core/context.js";
import type { AppConfig } from "../config.js";
import { isAbortError, isTurnFaultError } from "../core/results.js";
import type pino from "pino";

export interface ToolCall {
  block: LLMToolUseBlock;
  tool?: ToolDef;
}

/** The call a hook sees: the raw tool_use block, its resolved tool, and args. */
export interface ToolHookCall {
  block: LLMToolUseBlock;
  tool: ToolDef;
  args: Record<string, unknown>;
}

/**
 * Runs before a tool executes. Hooks run serially (prompts must never race);
 * the first `{ block: true }` short-circuits the rest and the call is not
 * executed — but the batch continues. A throwing hook degrades to a block,
 * never to an executed tool. Modeled on pi's beforeToolCall.
 */
export type BeforeToolCallHook = (
  call: ToolHookCall,
  ctx: ToolExecutionContext,
) => Promise<{ block: true; reason: string } | undefined>;

/**
 * Runs after a tool executed, before the result is written back. Chained:
 * each hook receives the previous hook's result; returning undefined keeps
 * it. A throwing hook is logged and skipped. Blocked/immediate calls do not
 * reach these hooks. Modeled on pi's afterToolCall.
 */
export type AfterToolCallHook = (
  call: ToolHookCall,
  result: ToolRunResult,
  ctx: ToolExecutionContext,
) => Promise<ToolRunResult | undefined>;

export interface ToolExecutorOpts {
  readonly tools: Map<string, ToolDef>;
  readonly beforeHooks?: readonly BeforeToolCallHook[];
  readonly afterHooks?: readonly AfterToolCallHook[];
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
  activeMessageId?: string;
}

/** Per-call outcome of the prepare phase. */
type Prepared =
  | { kind: "immediate"; content: string }
  | { kind: "prepared" };

/**
 * Executes tool calls through the hook pipeline. Decoupled from the Agent's
 * core LLM loop and from any concrete gate (permission lives in a
 * beforeToolCall hook wired by the composition root).
 */
export class ToolExecutor {
  private tools: Map<string, ToolDef>;
  private beforeHooks: readonly BeforeToolCallHook[];
  private afterHooks: readonly AfterToolCallHook[];
  private context: LLMContext;
  private logger?: pino.Logger;
  private appConfig?: AppConfig;
  private currentAgentId?: string;
  private capabilities: Capabilities;

  constructor(opts: ToolExecutorOpts) {
    this.tools = opts.tools;
    this.beforeHooks = opts.beforeHooks ?? [];
    this.afterHooks = opts.afterHooks ?? [];
    this.context = opts.context;
    this.logger = opts.logger;
    this.appConfig = opts.appConfig;
    this.currentAgentId = opts.currentAgentId;
    this.capabilities = opts.capabilities;
  }

  /**
   * Execute tool calls and push tool_result blocks.
   *
   * Prepare (hooks) is serialized so prompts never race; a blocked call fails
   * alone and the batch continues. Approved tools run concurrently and
   * results are written back in the original tool_use order. `"denied"` is
   * returned only when a tool itself denies (e.g. user cancelling a prompt).
   */
  async execute(
    toolCalls: ToolCall[],
    dynamic: ToolExecutionDynamic,
  ): Promise<"denied" | null> {
    if (toolCalls.length === 0) return null;

    const context: ToolExecutionContext = {
      appConfig: this.appConfig,
      currentAgentId: this.currentAgentId ?? MAIN_AGENT_ID,
      signal: dynamic.signal,
      config: dynamic.config,
      prompter: dynamic.prompter,
      activeMessageId: dynamic.activeMessageId,
      capabilities: this.capabilities,
    };

    this.logger?.info(
      {
        model: context.config.model.getName(),
        toolCount: toolCalls.length,
        tools: toolCalls.map((t) => t.block.name),
      },
      "Executing tools",
    );

    // Phase 1 — prepare: hooks serialized, first block short-circuits.
    const prepared: Prepared[] = new Array(toolCalls.length);
    for (let i = 0; i < toolCalls.length; i++) {
      const { block, tool } = toolCalls[i];
      if (!tool) {
        prepared[i] = {
          kind: "immediate",
          content: `Error: Tool '${block.name}' not found or not available.`,
        };
        this.logger?.warn(
          { toolName: block.name },
          "LLM attempted to use an unavailable tool",
        );
        continue;
      }
      const args = block.input as Record<string, unknown>;
      let blocked: { block: true; reason: string } | undefined;
      for (const hook of this.beforeHooks) {
        try {
          const verdict = await hook({ block, tool, args }, context);
          if (verdict?.block) {
            blocked = verdict;
            break;
          }
        } catch (reason) {
          blocked = {
            block: true,
            reason: `beforeToolCall hook failed: ${reason instanceof Error ? reason.message : String(reason)}`,
          };
          break;
        }
      }
      prepared[i] = blocked
        ? { kind: "immediate", content: `Error: ${blocked.reason}` }
        : { kind: "prepared" };
    }

    // Phase 2 + 3 — run approved tools, apply after hooks, keep results in
    // order. A batch containing any sequential tool runs entirely sequential
    // (pi rule); otherwise the calls run concurrently.
    const results: Array<{
      toolUseId: string;
      content: string;
      images?: LLMImage[];
    }> = new Array(toolCalls.length);
    let batchDenied = false;
    const runOne = async (i: number): Promise<void> => {
      const { block, tool } = toolCalls[i];
      const prep = prepared[i];
      if (prep.kind === "immediate") {
        results[i] = { toolUseId: block.id, content: prep.content };
        return;
      }

      let result: ToolRunResult;
      try {
        result = await tool!.execute(
          block.input as Record<string, unknown>,
          context,
        );
      } catch (reason) {
        // Turn failures (abort, fatal) must reach the turn boundary —
        // converting them into a tool-error string would swallow the
        // cancellation semantics.
        if (isAbortError(reason) || isTurnFaultError(reason)) throw reason;
        result = {
          outcome: "error",
          reason: reason instanceof Error ? reason.message : String(reason),
        };
        this.logger?.error(
          { toolName: tool!.name, error: String(reason) },
          "Tool error",
        );
      }

      for (const hook of this.afterHooks) {
        try {
          const next = await hook(
            {
              block,
              tool: tool!,
              args: block.input as Record<string, unknown>,
            },
            result,
            context,
          );
          if (next) result = next;
        } catch (reason) {
          this.logger?.warn(
            { toolName: tool!.name, error: String(reason) },
            "afterToolCall hook failed",
          );
        }
      }

      let content: string;
      let images: LLMImage[] | undefined;
      if (result.outcome === "denied") {
        content = result.reason;
        batchDenied = true;
      } else if (result.outcome === "error") {
        content = `Error: ${result.reason}`;
        this.logger?.info(
          { toolName: tool!.name, error: result.reason },
          "Tool soft-failed",
        );
      } else {
        content = result.result;
        images = result.images;
      }
      results[i] = { toolUseId: block.id, content, images };
    };

    const sequential = toolCalls.some(
      (call) => call.tool?.executionMode === "sequential",
    );
    if (sequential) {
      for (let i = 0; i < toolCalls.length; i++) await runOne(i);
    } else {
      await Promise.all(toolCalls.map((_, i) => runOne(i)));
    }

    for (const result of results) {
      this.context.completeToolCall(
        result.toolUseId,
        result.content,
        ...(result.images ? [result.images] : []),
      );
    }
    return batchDenied ? "denied" : null;
  }

  // -- Accessors for Agent to use in the LLM loop --

  getTools(): Map<string, ToolDef> {
    return this.tools;
  }
}
