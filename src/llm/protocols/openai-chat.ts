// OpenAI Chat Completions adapter.
//
// Implements the provider-agnostic LLMClient / LLMStream interfaces and
// converts between internal types and the OpenAI Chat Completions API format.

import OpenAI from "openai";
import { isAbortError } from "../../core/results.js";
import { faultFromError } from "./shared.js";
import type {
  LLMClient,
  LLMStream,
  LLMToolDef,
  ChatOptions,
  LLMStreamResult,
  StopReason,
  EffortLevel,
  LLMBlock,
} from "../client.js";
import type { LLMAssistantBlock, LLMToolUseBlock } from "../client.js";

// Constants

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_MAX_TOKENS = 8192;

// Effort mapping (internal → SDK reasoning_effort)

function toSdkEffort(effort: EffortLevel): OpenAI.ReasoningEffort {
  switch (effort) {
    case "none":
      return "none";
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "xhigh";
  }
}

// Stop reason mapping (OpenAI → internal)

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    case null:
      return "end_turn";
    default:
      return "unknown";
  }
}

// Message conversion (internal → SDK)

type OpenAIMessage =
  | OpenAI.ChatCompletionSystemMessageParam
  | OpenAI.ChatCompletionUserMessageParam
  | OpenAI.ChatCompletionAssistantMessageParam
  | OpenAI.ChatCompletionToolMessageParam;

function toSdkMessages(blocks: LLMBlock[], system?: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  let assistantBlocks: LLMAssistantBlock[] = [];

  // System message goes first
  if (system) {
    out.push({ role: "system", content: system });
  }

  const flushAssistant = () => {
    if (assistantBlocks.length === 0) return;

    const textParts: string[] = [];
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

    for (const block of assistantBlocks) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "thinking") {
        // Thinking blocks are not sent back in OpenAI format.
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const content = textParts.length > 0 ? textParts.join("") : null;

    if (toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content,
        tool_calls: toolCalls,
      });
    } else {
      out.push({
        role: "assistant",
        content: content ?? "",
      });
    }

    assistantBlocks = [];
  };

  for (const block of blocks) {
    if (block.type === "user") {
      flushAssistant();
      out.push({ role: "user", content: block.text });
    } else if (block.type === "tool_result") {
      flushAssistant();
      out.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: block.content,
      });
    } else {
      assistantBlocks.push(block);
    }
  }

  flushAssistant();
  return out;
}

// Tool definition conversion (internal → SDK)

function toSdkTools(tools: LLMToolDef[]): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// OpenAIChatClient

export class OpenAIChatClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  chatStream(
    blocks: LLMBlock[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const model = options.model?.getName() ?? DEFAULT_MODEL;
    const oaiMessages = toSdkMessages(blocks, options.system);
    const oaiTools = toSdkTools(tools);
    const abortController = new AbortController();

    // Wire external signal into our controller
    if (options.signal) {
      options.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model,
      max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: oaiMessages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (oaiTools.length > 0) {
      params.tools = oaiTools;
    }

    const effort = options.model?.getEffort();
    if (effort) {
      params.reasoning_effort = toSdkEffort(effort);
    }

    // The request starts lazily inside the generator: a stream that is never
    // consumed (e.g. the signal fired before the first next()) must not leave
    // an unobserved fetch rejection behind.
    const client = this.client;

    async function* run(): AsyncGenerator<
      LLMAssistantBlock,
      LLMStreamResult,
      unknown
    > {
      try {
        const stream = await client.chat.completions.create(params, {
          signal: abortController.signal,
        });

        let textContent = "";
        let thinkingContent = "";
        const pendingToolCalls: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();
        let finishReason: string | null = null;
        let usage: OpenAI.CompletionUsage | undefined;

        for await (const chunk of stream) {
          if (chunk.usage) {
            usage = chunk.usage;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) {
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
            continue;
          }

          if (chunk.choices[0].finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }

          if (delta.content) {
            textContent += delta.content;
            yield { type: "text", text: delta.content };
          }

          // @ts-expect-error - reasoning_content not yet in types
          const reasoning = delta.reasoning_content;
          if (typeof reasoning === "string" && reasoning.length > 0) {
            thinkingContent += reasoning;
            yield { type: "thinking", thinking: reasoning };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let pending = pendingToolCalls.get(idx);

              if (!pending) {
                pending = {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  arguments: "",
                };
                pendingToolCalls.set(idx, pending);
              }

              if (tc.id) pending.id = tc.id;
              if (tc.function?.name) pending.name = tc.function.name;
              if (tc.function?.arguments)
                pending.arguments += tc.function.arguments;
            }
          }
        }

        const content: LLMAssistantBlock[] = [];

        if (thinkingContent.length > 0) {
          content.push({ type: "thinking", thinking: thinkingContent });
        }

        if (textContent.length > 0) {
          content.push({ type: "text", text: textContent });
        }

        for (const [, pending] of pendingToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(pending.arguments);
          } catch {}
          const block: LLMToolUseBlock = {
            type: "tool_use",
            id: pending.id,
            name: pending.name,
            input,
          };
          content.push(block);
          yield block;
        }

        return {
          ok: true,
          content,
          stop_reason: mapStopReason(finishReason),
          usage: {
            input: {
              total: usage?.prompt_tokens ?? 0,
              cache_miss: 0,
              cache_hit: 0,
            },
            output: usage?.completion_tokens ?? 0,
          },
        };
      } catch (e) {
        if (isAbortError(e)) throw e;
        return { ok: false, fault: faultFromError(e) };
      }
    }

    return run();
  }
}
