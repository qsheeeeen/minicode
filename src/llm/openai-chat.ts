/**
 * OpenAI Chat Completions adapter.
 *
 * Implements the provider-agnostic LLMClient / LLMStream interfaces and
 * converts between canonical types (./types.ts) and the OpenAI Chat
 * Completions API format.
 */

import OpenAI from "openai";
import { EventEmitter } from "events";
import type { LLMClient, LLMStream } from "./client.js";
import type {
  MessageParam,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  TokenUsage,
  EffortLevel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Effort mapping (canonical → OpenAI reasoning_effort)
// ---------------------------------------------------------------------------

function mapEffort(effort: EffortLevel): any {
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

// ---------------------------------------------------------------------------
// Stop reason mapping (OpenAI → canonical)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Message conversion (canonical → OpenAI)
// ---------------------------------------------------------------------------

type OpenAIMessage =
  | OpenAI.ChatCompletionSystemMessageParam
  | OpenAI.ChatCompletionUserMessageParam
  | OpenAI.ChatCompletionAssistantMessageParam
  | OpenAI.ChatCompletionToolMessageParam;

function convertMessages(
  messages: MessageParam[],
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
        const blocks = msg.content as ToolResultBlock[];
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
          const text = (msg.content as ContentBlock[])
            .filter((b): b is TextBlock => b.type === "text")
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
        const blocks = msg.content as ContentBlock[];
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

// ---------------------------------------------------------------------------
// Tool definition conversion (canonical → OpenAI)
// ---------------------------------------------------------------------------

function convertTools(
  tools: LLMToolDef[],
): OpenAI.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Response conversion (OpenAI → canonical)
// ---------------------------------------------------------------------------

function convertResponse(
  choice: OpenAI.ChatCompletion.Choice,
  usage: OpenAI.CompletionUsage | undefined,
): LLMResponse {
  const content: ContentBlock[] = [];
  const msg = choice.message;

  // Reasoning content → ThinkingBlock (o1/o3/o4-mini models)
  const reasoning = (msg as unknown as Record<string, unknown>).reasoning_content;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    content.push({ type: "thinking", thinking: reasoning });
  }

  // Text content → TextBlock
  if (msg.content) {
    content.push({ type: "text", text: msg.content });
  }

  // Tool calls → ToolUseBlock[]
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      if (tc.type === "function") {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // malformed JSON — keep empty object
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }
  }

  return {
    content,
    stop_reason: mapStopReason(choice.finish_reason),
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAIChatStream
// ---------------------------------------------------------------------------

/** Accumulated state for a single in-flight tool call. */
interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAIChatStream extends EventEmitter implements LLMStream {
  private resolve!: (value: LLMResponse) => void;
  private reject!: (reason: unknown) => void;
  private promise: Promise<LLMResponse>;
  private abortController: AbortController;

  constructor(
    streamPromise: Promise<AsyncIterable<OpenAI.ChatCompletionChunk>>,
    abortController: AbortController,
  ) {
    super();
    this.abortController = abortController;
    this.promise = new Promise<LLMResponse>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.consume(streamPromise);
  }

  finalMessage(): Promise<LLMResponse> {
    return this.promise;
  }

  abort(): void {
    this.abortController.abort();
  }

  private async consume(
    streamPromise: Promise<AsyncIterable<OpenAI.ChatCompletionChunk>>,
  ): Promise<void> {
    // Yield to the event loop so callers can attach listeners before
    // consumption begins.
    await Promise.resolve();

    try {
      const stream = await streamPromise;

      let textContent = "";
      let thinkingContent = "";
      const pendingToolCalls: Map<number, PendingToolCall> = new Map();
      let finishReason: string | null = null;
      let usage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        // Usage comes on the final chunk when stream_options.include_usage is set
        if (chunk.usage) {
          usage = chunk.usage;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          // Final chunk may have no choices
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }
          continue;
        }

        if (chunk.choices[0].finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }

        // Text content
        if (delta.content) {
          textContent += delta.content;
          this.emit("text", delta.content);
        }

        // Reasoning content (o1/o3/o4-mini reasoning models)
        const reasoning = (delta as Record<string, unknown>).reasoning_content;
        if (typeof reasoning === "string" && reasoning.length > 0) {
          thinkingContent += reasoning;
          this.emit("thinking", reasoning);
        }

        // Tool calls (incremental)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            let pending = pendingToolCalls.get(idx);

            if (!pending) {
              // New tool call starting
              pending = {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: "",
              };
              pendingToolCalls.set(idx, pending);
            }

            if (tc.id) {
              pending.id = tc.id;
            }
            if (tc.function?.name) {
              pending.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              pending.arguments += tc.function.arguments;
            }
          }
        }
      }

      // --- Stream ended: build final response ---

      const content: ContentBlock[] = [];

      // Emit completed thinking block
      if (thinkingContent.length > 0) {
        const block: ThinkingBlock = {
          type: "thinking",
          thinking: thinkingContent,
        };
        content.push(block);
        this.emit("contentBlock", block);
      }

      // Emit completed text block
      if (textContent.length > 0) {
        const block: TextBlock = { type: "text", text: textContent };
        content.push(block);
        this.emit("contentBlock", block);
      }

      // Emit completed tool call blocks
      for (const [, pending] of pendingToolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(pending.arguments);
        } catch {
          // malformed JSON — keep empty object
        }
        const block: ToolUseBlock = {
          type: "tool_use",
          id: pending.id,
          name: pending.name,
          input,
        };
        content.push(block);
        this.emit("contentBlock", block);
      }

      const response: LLMResponse = {
        content,
        stop_reason: mapStopReason(finishReason),
        usage: {
          input_tokens: usage?.prompt_tokens ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
        },
      };

      this.resolve(response);
    } catch (err) {
      this.reject(err);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAIChatClient
// ---------------------------------------------------------------------------

export class OpenAIChatClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): Promise<LLMResponse> {
    const model = options.model ?? DEFAULT_MODEL;
    const oaiMessages = convertMessages(messages, options.system);
    const oaiTools = convertTools(tools);

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: oaiMessages,
      stream: false,
    };

    if (oaiTools.length > 0) {
      params.tools = oaiTools;
    }

    if (options.effort) {
      params.reasoning_effort = mapEffort(options.effort);
    }

    const completion = await this.client.chat.completions.create(params, {
      signal: options.signal,
    });

    return convertResponse(completion.choices[0], completion.usage);
  }

  chatStream(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const model = options.model ?? DEFAULT_MODEL;
    const oaiMessages = convertMessages(messages, options.system);
    const oaiTools = convertTools(tools);
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

    if (options.effort) {
      params.reasoning_effort = mapEffort(options.effort);
    }

    const streamPromise = this.client.chat.completions.create(params, {
      signal: abortController.signal,
    }) as Promise<AsyncIterable<OpenAI.ChatCompletionChunk>>;

    return new OpenAIChatStream(streamPromise, abortController);
  }
}
