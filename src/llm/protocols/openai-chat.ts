// OpenAI Chat Completions adapter.
//
// Implements the provider-agnostic LLMClient / LLMStream interfaces and
// converts between internal types and the OpenAI Chat Completions API format.

import OpenAI from "openai";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_OPENAI_MODEL,
  parseToolArgs,
  terminalFromError,
  toOpenAiEffort,
} from "./shared.js";
import type {
  LLMClient,
  LLMStream,
  LLMToolDef,
  ChatOptions,
  LLMStreamResult,
  StopReason,
} from "../client.js";
import type {
  LLMBlock,
  LLMAssistantBlock,
  LLMToolUseBlock,
} from "../../core/blocks.js";

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

function toSdkMessages(
  blocks: readonly LLMBlock[],
  system?: string,
): OpenAIMessage[] {
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
    const model = options.model?.getName() ?? DEFAULT_OPENAI_MODEL;
    const oaiMessages = toSdkMessages(blocks, options.system);
    const oaiTools = toSdkTools(tools);

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
      params.reasoning_effort = toOpenAiEffort(effort);
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
          signal: options.signal,
        });

        const textParts: string[] = [];
        const thinkingParts: string[] = [];
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
            textParts.push(delta.content);
            yield { type: "text", text: delta.content };
          }

          // @ts-expect-error - reasoning_content not yet in types
          const reasoning = delta.reasoning_content;
          if (typeof reasoning === "string" && reasoning.length > 0) {
            thinkingParts.push(reasoning);
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

        if (thinkingParts.length > 0) {
          content.push({ type: "thinking", thinking: thinkingParts.join("") });
        }

        if (textParts.length > 0) {
          content.push({ type: "text", text: textParts.join("") });
        }

        for (const [, pending] of pendingToolCalls) {
          const block: LLMToolUseBlock = {
            type: "tool_use",
            id: pending.id,
            name: pending.name,
            input: parseToolArgs(pending.arguments),
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
              // OpenAI reports cached prompt tokens separately; treat the
              // remainder as cache misses (mirror of the Anthropic mapping).
              cache_hit: usage?.prompt_tokens_details?.cached_tokens ?? 0,
              cache_miss:
                (usage?.prompt_tokens ?? 0) -
                (usage?.prompt_tokens_details?.cached_tokens ?? 0),
            },
            output: usage?.completion_tokens ?? 0,
          },
        };
      } catch (e) {
        return terminalFromError(e);
      }
    }

    return run();
  }
}
