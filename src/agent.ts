import { TurnFaultError, abortError } from "./core/results.js";
import type { AppConfig } from "./config.js";
import type { Model } from "./llm/model.js";
import type {
  LLMClient,
  LLMToolDef,
  LLMStreamOk,
  LLMStreamResult,
} from "./llm/client.js";
import type { LLMAssistantBlock } from "./core/blocks.js";
import type { ToolExecutor, ToolCall } from "./tools/executor.js";
import type { UserPrompter } from "./core/prompt.js";
import type { ToolDef, Capabilities } from "./tools/registry.js";
import type { PromptManager } from "./services/prompt-manager.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
import type { PermissionService } from "./services/permission.js";
import type { RuntimeEvents } from "./services/runtime-events.js";
import type { SteeringQueue } from "./services/steering-queue.js";
import type { SessionStats } from "./services/session-stats.js";
import type pino from "pino";

/**
 * Dependencies for runAgent. This is a mutable parameter bag owned by the
 * caller — runAgent only reads it. `client`/`model`/`logger` are writable
 * fields so the caller can swap them (model switch, session switch) without
 * runAgent holding any state of its own.
 */
export interface AgentDeps {
  client: LLMClient;
  model: Model;
  logger?: pino.Logger;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  toolExecutor: ToolExecutor;
  promptManager: PromptManager;
  /** Mid-run message queue (main agent only; sub-agents never get one). */
  steering?: SteeringQueue;
}

/**
 * AgentRuntimeOpts — the unified contract for building an agent runtime.
 * The main agent and every sub-agent go through the same factory
 * (app/create-agent-runtime.ts); only the parameters differ.
 */
export interface AgentRuntimeOpts {
  client: LLMClient;
  model: Model;
  userPrompt: string;
  projectPromptFile?: string;
  roleSystemPrompt?: string;
  skills?: ReadonlyArray<{ name: string; description: string }>;
  tools: Map<string, ToolDef<any>>;
  permissionService: PermissionService;
  currentAgentId: string;
  appConfig?: AppConfig;
  sessionStats?: SessionStats;
  /** Shared event bus; omitted → the runtime creates its own (sub-agents). */
  events?: RuntimeEvents;
  /** Steering queue for mid-run user input; main agent only. */
  steering?: SteeringQueue;
  compressionThresholdRatio?: number;
  /**
   * Capability assembly, evaluated after the runtime's own SessionManager
   * exists (so changeJournal can come from the fresh session).
   */
  capabilities: (parts: { sessionManager: SessionManager }) => Capabilities;
  /** Live handles for client/model/logger (main follows RuntimeState). */
  getClient?: () => LLMClient;
  getModel?: () => Model;
  getLogger?: () => pino.Logger | undefined;
  /** Persist the session to disk (main: true; sub-agents: false). */
  persistent?: boolean;
}

export interface AgentRuntime {
  deps: AgentDeps;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  runtimeEvents: RuntimeEvents;
}

/** The main agent's registry id; sub-agents allocate their own. */
export { MAIN_AGENT_ID } from "./tools/registry.js";

export interface RunAgentOpts {
  prompter?: UserPrompter;
}

/**
 * A truncated (max_tokens) response may carry half-received tool arguments —
 * executing them would act on incomplete input. The whole batch is failed
 * back to the model instead (pi semantics) so it can re-issue with complete
 * arguments. Cap consecutive truncation rounds so a model stuck re-truncating
 * cannot burn tokens forever.
 */
const MAX_TRUNCATED_ROUNDS = 3;
const TRUNCATED_TOOL_RESULT =
  "Error: Output reached the token limit; this tool call may be truncated. " +
  "Please re-send the complete call.";

/**
 * A promise that rejects as AbortError the moment the signal fires — even if
 * the awaited promise never settles (a stalled provider must not make the run
 * un-abortable). One promise serves the whole stream; each chunk races it.
 */
function abortRace(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), {
      once: true,
    });
  });
}

async function saveStore(
  deps: AgentDeps,
  opts?: { final?: boolean },
): Promise<void> {
  await deps.sessionManager
    .saveStore(
      {
        model: deps.model.getName(),
        totalTokens: deps.contextManager.getTokenCount(),
      },
      opts,
    )
    .catch((e: unknown) => {
      deps.logger?.error({ error: String(e) }, "Failed to save session");
    });
}

// Stream LLM response, updating context in real-time.
// Returns the successful stream result and any tool calls the LLM requested;
// provider faults (ok:false terminal values) become TurnFaultError here —
// the single conversion point between the value channel and the fault
// exception that ends the turn.
async function streamLLM(
  deps: AgentDeps,
  toolDefs: LLMToolDef[],
  signal: AbortSignal,
): Promise<{ result: LLMStreamOk; toolCalls: ToolCall[] }> {
  const context = deps.sessionManager.getContext();
  const stream = deps.client.chatStream(context.getBlocksReadonly(), toolDefs, {
    system: deps.promptManager.getSystemPrompt(),
    model: deps.model,
    signal,
  });

  const toolCalls: ToolCall[] = [];
  const onAbort = abortRace(signal);

  let result: LLMStreamOk | undefined;
  try {
    while (true) {
      signal.throwIfAborted();

      const next = stream.next();
      next.catch(() => {}); // lose the race → no unhandled rejection
      const raced = (await Promise.race([next, onAbort])) as IteratorResult<
        LLMAssistantBlock,
        LLMStreamResult
      >;
      if (raced.done) {
        const terminal = raced.value;
        if (!terminal.ok) throw new TurnFaultError(terminal.fault);
        result = terminal;
        break;
      }

      const chunk = raced.value;
      if (chunk.type === "thinking") {
        context.appendThinking(chunk.thinking);
      } else if (chunk.type === "text") {
        context.appendAssistantText(chunk.text);
      } else if (chunk.type === "tool_use") {
        const tool = deps.toolExecutor.getTools().get(chunk.name);
        toolCalls.push({ block: chunk, tool });
        context.startToolCall(chunk.id, chunk.name, chunk.input);
      }
    }

    signal.throwIfAborted();
    if (!result) throw new Error("Stream closed without returning a result");
  } catch (e) {
    signal.throwIfAborted();
    throw e;
  } finally {
    saveStore(deps);
  }

  return { result, toolCalls };
}

export async function runAgent(
  deps: AgentDeps,
  userMessage: string,
  signal: AbortSignal,
  opts?: RunAgentOpts,
): Promise<void> {
  const context = deps.sessionManager.getContext();
  const messageId = context.startUserMessage(userMessage);
  deps.sessionManager.setActiveMessageId(messageId);
  // Pick up messages queued during a previous run's denied-break — they were
  // typed while that run was going and belong to this one.
  injectSteered(deps);

  deps.logger?.info(
    { session: deps.sessionManager.getSessionName(), userMessage },
    "Session started",
  );

  try {
    // Tool set is fixed for the run — build once outside the loop.
    const toolDefs: LLMToolDef[] = [...deps.toolExecutor.getTools().values()];
    let truncatedRounds = 0;

    while (true) {
      signal.throwIfAborted();

      const { result, toolCalls } = await streamLLM(deps, toolDefs, signal);

      if (result.usage) {
        await deps.contextManager.processUsage(result.usage);
      }
      deps.logger?.info(
        {
          session: deps.sessionManager.getSessionName(),
          input: result.usage?.input,
          output: result.usage?.output,
          stopReason: result.stop_reason,
        },
        "LLM response",
      );

      signal.throwIfAborted();

      if (result.stop_reason === "max_tokens" && toolCalls.length > 0) {
        truncatedRounds++;
        // The truncated assistant message stays as-is; every tool_use gets
        // an error result so the model can re-issue the batch. Steered
        // messages are not drained here — the model is mid-reissue.
        for (const { block } of toolCalls) {
          context.completeToolCall(block.id, TRUNCATED_TOOL_RESULT);
        }
        await saveStore(deps);
        if (truncatedRounds > MAX_TRUNCATED_ROUNDS) {
          deps.sessionManager.reportStatus({
            role: "error",
            content: "(Stopped: repeated max_tokens truncation)",
          });
          break;
        }
        continue;
      }
      truncatedRounds = 0;

      const outcome = await deps.toolExecutor.execute(toolCalls, {
        signal,
        config: {
          client: deps.client,
          model: deps.model,
          userPrompt: deps.promptManager.getUserPrompt(),
        },
        prompter: opts?.prompter,
        activeMessageId: deps.sessionManager.getActiveMessageId(),
      });
      if (outcome === "denied") {
        await saveStore(deps);
        break;
      }

      // Steered messages inject between iterations; a queued message also
      // keeps the loop alive when the model had nothing left to do.
      const injected = injectSteered(deps);
      if (toolCalls.length === 0 && !injected) break;
      await saveStore(deps);
    }
  } finally {
    if (signal.aborted) {
      // Drop the user message that triggered this aborted run (and
      // everything after it) — by stable id, not by content matching. This
      // covers steered messages injected during the run too.
      context.truncateBeforeUserMessageId(messageId);
      // Anything still queued was never injected — drop it rather than
      // surprising the next run.
      deps.steering?.clear();
    }
    deps.logger?.info(
      {
        session: deps.sessionManager.getSessionName(),
        totalTokens: deps.contextManager.getTokenCount(),
      },
      "Session ended",
    );
    // End of the run: the tail turn is complete — persist it too.
    await saveStore(deps, { final: true });
  }
}

/** Drain the steering queue into the context as ordinary user messages.
 *  Returns true when anything was injected. */
function injectSteered(deps: AgentDeps): boolean {
  const queued = deps.steering?.drain() ?? [];
  for (const text of queued) {
    const id = deps.sessionManager.getContext().startUserMessage(text);
    deps.sessionManager.setActiveMessageId(id);
  }
  return queued.length > 0;
}
