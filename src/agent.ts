import type { Model } from "./llm/model.js";
import type { LLMClient, LLMToolDef, LLMStreamResult } from "./llm/client.js";
import { ToolDeniedError } from "./tools/index.js";
import type { ToolExecutor, ToolCall } from "./tools/executor.js";
import type { UserPrompter } from "./tools/registry.js";
import type { PromptManager } from "./services/prompt-manager.js";
import type { SessionManager } from "./services/session-manager.js";
import type { ContextManager } from "./services/context-manager.js";
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
}

export interface RunAgentOpts {
  displayContent?: string;
  prompter?: UserPrompter;
}

/** True for the AbortError raised by signal.throwIfAborted(). */
export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name: unknown }).name === "AbortError"
  );
}

async function saveStore(deps: AgentDeps): Promise<void> {
  await deps.sessionManager
    .saveStore({
      model: deps.model.getName(),
      totalTokens: deps.contextManager.getTokenCount(),
    })
    .catch((e: unknown) => {
      deps.logger?.error({ error: String(e) }, "Failed to save session");
    });
}

// Stream LLM response, updating context in real-time.
// Returns the stream result and any tool calls the LLM requested.
async function streamLLM(
  deps: AgentDeps,
  toolDefs: LLMToolDef[],
  signal: AbortSignal,
): Promise<{ result: LLMStreamResult; toolCalls: ToolCall[] }> {
  const context = deps.sessionManager.getContext();
  const stream = deps.client.chatStream(context.getBlocks(), toolDefs, {
    system: deps.promptManager.getSystemPrompt(),
    model: deps.model,
    signal,
  });

  const toolCalls: ToolCall[] = [];

  const handleDelta = (field: "text" | "thinking", delta: string) => {
    if (field === "thinking") context.appendThinking(delta);
    else context.appendAssistantText(delta);
  };

  let result: LLMStreamResult | undefined;
  try {
    while (true) {
      signal.throwIfAborted();

      const next = await stream.next();
      if (next.done) {
        result = next.value as LLMStreamResult;
        break;
      }

      const chunk = next.value;
      if (chunk.type === "text" || chunk.type === "thinking") {
        // @ts-expect-error - text or thinking fields exist based on type
        handleDelta(chunk.type, chunk[chunk.type]);
      } else if (chunk.type === "tool_use") {
        const tool = deps.toolExecutor.getTools().get(chunk.name);
        toolCalls.push({ block: chunk, tool });
        context.startToolCall(chunk.id, chunk.name, chunk.input);
        saveStore(deps);
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

  return { result: result!, toolCalls };
}

export async function runAgent(
  deps: AgentDeps,
  userMessage: string,
  signal: AbortSignal,
  opts?: RunAgentOpts,
): Promise<void> {
  const context = deps.sessionManager.getContext();
  context.startUserMessage(userMessage);
  deps.sessionManager.setActiveUserMessageOrdinal(
    context.getUserMessageCount(),
  );

  deps.logger?.info(
    { session: deps.sessionManager.getSessionName(), userMessage },
    "Session started",
  );

  try {
    // Tool set is fixed for the run — build once outside the loop.
    const toolDefs = [...deps.toolExecutor.getTools().values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })) as LLMToolDef[];

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

      try {
        await deps.toolExecutor.execute(toolCalls, {
          signal,
          config: {
            client: deps.client,
            model: deps.model,
            userPrompt: deps.promptManager.getUserPrompt(),
          },
          prompter: opts?.prompter,
          activeUserMessageOrdinal:
            deps.sessionManager.getActiveUserMessageOrdinal(),
          changeJournal: deps.sessionManager.getChangeJournal(),
        });
      } catch (e) {
        if (e instanceof ToolDeniedError) {
          deps.sessionManager.reportStatus({
            role: "error",
            content: `Tool "${e.toolName}" was denied by user`,
            timestamp: new Date(),
          });
          break;
        }
        throw e;
      }

      if (toolCalls.length > 0) {
        await saveStore(deps);
      }

      if (toolCalls.length === 0) break;
    }
  } finally {
    if (signal.aborted) {
      // Remove the last user message that triggered this aborted run
      context.removeFromLastUserMessage(
        (last) => last[0]?.type === "user" && last[0].text === userMessage,
      );
    }
    deps.logger?.info(
      {
        session: deps.sessionManager.getSessionName(),
        totalTokens: deps.contextManager.getTokenCount(),
      },
      "Session ended",
    );
    await saveStore(deps);
  }
}
