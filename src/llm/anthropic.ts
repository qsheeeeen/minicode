// Anthropic adapter — wraps the `@anthropic-ai/sdk` and implements the
// canonical `LLMClient` / `LLMStream` interfaces.

import Anthropic from "@anthropic-ai/sdk";
import {
  MessageStreamEvent,
  MessageStream,
} from "@anthropic-ai/sdk/lib/MessageStream.js";
import type { LLMStream, StreamEvent } from "./client.js";
import type {
  MessageCreateParamsBase,
  MessageCreateParamsNonStreaming,
  OutputConfig,
} from "@anthropic-ai/sdk/resources/messages.js";

import type { LLMClient } from "./client.js";
import type {
  MessageParam,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  ContentBlock,
  EffortLevel,
} from "./types.js";

// Re-export EffortLevel for backward compat in config.ts etc.
export type { EffortLevel };

function mapEffort(effort: EffortLevel): any {
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

// Anthropic-native types (used only inside this adapter)

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicContentBlock = Anthropic.Messages.ContentBlock;

// Conversion helpers

// Convert canonical messages to Anthropic SDK format.
// Since our canonical format is modeled after Anthropic's, the conversion
// is mostly a pass-through.
function toAnthropicMessages(messages: MessageParam[]): AnthropicMessageParam[] {
  return messages as unknown as AnthropicMessageParam[];
}

function toAnthropicTools(tools: LLMToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as AnthropicTool["input_schema"],
  }));
}

function toCanonicalResponse(msg: Anthropic.Messages.Message): LLMResponse {
  return {
    content: msg.content as unknown as ContentBlock[],
    stop_reason: msg.stop_reason ?? "end_turn",
    usage: {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_creation_input_tokens:
        (msg.usage as any).cache_creation_input_tokens ?? 0,
      cache_read_input_tokens:
        (msg.usage as any).cache_read_input_tokens ?? 0,
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
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const params: MessageCreateParamsBase = {
      model: options.model || "claude-sonnet-4-5",
      max_tokens: options.maxTokens || 8192,
      system: options.system,
      messages: toAnthropicMessages(messages),
      tools: toAnthropicTools(tools),
      thinking: { type: "adaptive" },
    };

    if (options.effort) {
      params.output_config = {
        effort: mapEffort(options.effort),
      };
    }

    const stream = this.client.messages.stream(params, {
      signal: options.signal,
    }) as unknown as MessageStream<null>;

    async function* run(): AsyncGenerator<StreamEvent, LLMResponse, unknown> {
      let currentToolCall: any = null;
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
              type: "contentBlock",
              block: {
                type: "tool_use",
                id: currentToolCall.id,
                name: currentToolCall.name,
                input,
              },
            };
            currentToolCall = null;
          } else if (currentThinking) {
            yield {
              type: "contentBlock",
              block: { type: "thinking", thinking: currentThinking },
            };
            currentThinking = "";
          } else if (currentText) {
            yield {
              type: "contentBlock",
              block: { type: "text", text: currentText },
            };
            currentText = "";
          }
        }
      }

      const finalMsg = await stream.finalMessage();
      return toCanonicalResponse(finalMsg);
    }

    return run();
  }
}
