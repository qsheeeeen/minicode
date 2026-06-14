// OpenAI Chat Completions adapter.
//
// Implements the provider-agnostic LLMClient / LLMStream interfaces and
// converts between internal types and the OpenAI Chat Completions API format.

import OpenAI from "openai";
import type {
  LLMClient,
  LLMStream,
  StreamEvent,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  EffortLevel,
  LLMBlock,
} from "../client.js";
import type {
  LLMAssistantBlock,
  LLMTextBlock,
  LLMToolUseBlock,
  LLMToolResultBlock,
} from "../client.js";
import {
  blocksToChatMessages,
  type ChatMessage,
} from "./message-projection.js";

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

function mapStopReason(reason: string | null): string {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return reason ?? "end_turn";
  }
}

// Message conversion (internal → SDK)

type OpenAIMessage =
  | OpenAI.ChatCompletionSystemMessageParam
  | OpenAI.ChatCompletionUserMessageParam
  | OpenAI.ChatCompletionAssistantMessageParam
  | OpenAI.ChatCompletionToolMessageParam;

function toSdkMessages(
  messages: ChatMessage[],
  system?: string,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  // System message goes first
  if (system) {
    out.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Check if these are tool results
        const blocks = msg.content as LLMToolResultBlock[];
        if (blocks.length > 0 && blocks[0].type === "tool_result") {
          for (const block of blocks) {
            out.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        } else {
          // Fallback: concatenate text blocks
          const text = (msg.content as LLMAssistantBlock[])
            .filter((b): b is LLMTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
          out.push({ role: "user", content: text });
        }
      }
    } else {
      // assistant
      if (typeof msg.content === "string") {
        out.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content as LLMAssistantBlock[];
        const textParts: string[] = [];
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

        for (const block of blocks) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "thinking") {
            // Thinking blocks are not sent back in OpenAI format
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
      }
    }
  }

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
    const messages = blocksToChatMessages(blocks);
    const oaiMessages = toSdkMessages(messages, options.system);
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

    const streamPromise = this.client.chat.completions.create(params, {
      signal: abortController.signal,
    });

    async function* run(): AsyncGenerator<StreamEvent, LLMResponse, unknown> {
      const stream = await streamPromise;

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
        yield { type: "tool_use", block };
      }

      return {
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
    }

    return run();
  }
}
