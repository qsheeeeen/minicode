// Anthropic adapter — wraps the `@anthropic-ai/sdk` and implements the
// provider-agnostic `LLMClient` / `LLMStream` interfaces.

import Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import type { LLMStream } from "../client.js";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";

import type {
  LLMClient,
  LLMToolDef,
  ChatOptions,
  LLMStreamResult,
  EffortLevel,
  LLMBlock,
} from "../client.js";
import type { LLMAssistantBlock } from "../client.js";

function toSdkEffort(
  effort: EffortLevel,
): "low" | "medium" | "high" | "xhigh" | "max" {
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    case "max":
      return "max";
  }
}

type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicContentBlockParam = Anthropic.Messages.ContentBlockParam;

// Convert internal messages to Anthropic SDK format.
// Thinking blocks are filtered out — they're output-only and not accepted
// as input by the API (adaptive thinking reconstructs context automatically).
function toSdkMessages(blocks: LLMBlock[]): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = [];
  let assistantBlocks: LLMAssistantBlock[] = [];
  // Anthropic requires ALL tool_result blocks for one assistant message to
  // arrive together, in the user message immediately after the tool_use
  // blocks — so accumulate consecutive results and flush them as one message.
  let pendingToolResults: AnthropicContentBlockParam[] = [];

  const flushAssistant = () => {
    if (assistantBlocks.length === 0) return;

    const content: AnthropicContentBlockParam[] = [];
    for (const b of assistantBlocks) {
      if (b.type === "text") {
        content.push({ type: "text" as const, text: b.text });
      } else if (b.type === "tool_use") {
        content.push({
          type: "tool_use" as const,
          id: b.id,
          name: b.name,
          input: b.input,
        });
      }
      // thinking blocks are skipped — not accepted as input
    }
    out.push({ role: "assistant" as const, content });
    assistantBlocks = [];
  };

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    flushAssistant();
    out.push({ role: "user" as const, content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const block of blocks) {
    if (block.type === "user") {
      flushToolResults();
      flushAssistant();
      out.push({ role: "user" as const, content: block.text });
    } else if (block.type === "tool_result") {
      pendingToolResults.push({
        type: "tool_result" as const,
        tool_use_id: block.tool_use_id,
        content: block.content,
      });
    } else {
      flushToolResults();
      assistantBlocks.push(block);
    }
  }

  flushToolResults();
  flushAssistant();
  return out;
}

function toSdkTools(tools: LLMToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as AnthropicTool["input_schema"],
  }));
}

// Map SDK content blocks to our internal types.
// SDK LLMThinkingBlock has extra fields (signature, redacted_thinking variants)
// that our LLMThinkingBlock doesn't carry.
function toLLMAssistantBlock(block: Anthropic.ContentBlock): LLMAssistantBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: block.thinking };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  // Fallback for unknown block types (server_tool_use, etc.)
  return { type: "text", text: JSON.stringify(block) };
}

// Anthropic usage includes cache token fields not in the standard type.
interface AnthropicCacheUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function toLLMStreamResult(msg: Anthropic.Messages.Message): LLMStreamResult {
  const cacheUsage = msg.usage as typeof msg.usage & AnthropicCacheUsage;
  const cacheMiss = cacheUsage.cache_creation_input_tokens ?? 0;
  const cacheHit = cacheUsage.cache_read_input_tokens ?? 0;
  return {
    content: msg.content.map(toLLMAssistantBlock),
    stop_reason: msg.stop_reason ?? "end_turn",
    usage: {
      input: {
        total: msg.usage.input_tokens,
        cache_miss: cacheMiss,
        cache_hit: cacheHit,
      },
      output: msg.usage.output_tokens,
    },
  };
}

// Client

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new Anthropic({
      apiKey,
      authToken: apiKey ?? null,
      baseURL,
    });
  }

  chatStream(
    blocks: LLMBlock[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const params: MessageCreateParamsStreaming = {
      model: options.model?.getName() || "claude-sonnet-4-5",
      max_tokens: options.maxTokens || 8192,
      stream: true,
      system: options.system,
      messages: toSdkMessages(blocks),
      tools: toSdkTools(tools),
      thinking: { type: "adaptive" },
    };

    const effort = options.model?.getEffort();
    if (effort) {
      params.output_config = {
        effort: toSdkEffort(effort),
      };
    }

    const stream = this.client.messages.stream(params, {
      signal: options.signal,
    });

    async function* run(): AsyncGenerator<
      LLMAssistantBlock,
      LLMStreamResult,
      unknown
    > {
      let currentToolCall: {
        id: string;
        name: string;
        arguments: string;
      } | null = null;
      let currentText = "";
      let currentThinking = "";

      for await (const chunk of stream) {
        const event = chunk as MessageStreamEvent;
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            currentToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: "",
            };
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
            currentText += event.delta.text;
          } else if (event.delta.type === "thinking_delta") {
            yield { type: "thinking", thinking: event.delta.thinking };
            currentThinking += event.delta.thinking;
          } else if (event.delta.type === "input_json_delta") {
            if (currentToolCall) {
              currentToolCall.arguments += event.delta.partial_json;
            }
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolCall) {
            let input = {};
            try {
              input = JSON.parse(currentToolCall.arguments);
            } catch {}
            yield {
              type: "tool_use",
              id: currentToolCall.id,
              name: currentToolCall.name,
              input,
            };
            currentToolCall = null;
          } else if (currentThinking) {
            currentThinking = "";
          } else if (currentText) {
            currentText = "";
          }
        }
      }

      const finalMsg = await stream.finalMessage();
      return toLLMStreamResult(finalMsg);
    }

    return run();
  }
}
