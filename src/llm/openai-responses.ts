/**
 * OpenAI Responses API adapter.
 *
 * Implements the canonical LLMClient / LLMStream interfaces, converting
 * between our provider-agnostic types and the OpenAI Responses API format.
 *
 * The Responses API (`client.responses.create()`) uses a flat `input` array
 * of items rather than the chat-completions message array.
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
// Effort mapping
// ---------------------------------------------------------------------------

/** Map our five-level effort to OpenAI's three-level reasoning effort. */
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
// Tool definition conversion
// ---------------------------------------------------------------------------

/** Convert a canonical LLMToolDef to an OpenAI Responses function tool. */
function convertToolDef(
  tool: LLMToolDef,
): OpenAI.Responses.FunctionTool {
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as OpenAI.FunctionParameters,
    strict: false,
  };
}

// ---------------------------------------------------------------------------
// Message conversion (canonical → OpenAI Responses input)
// ---------------------------------------------------------------------------

type ResponseInputItem = OpenAI.Responses.ResponseInputItem;

/** Convert canonical MessageParam[] to an OpenAI Responses `input` array. */
function convertMessages(messages: MessageParam[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        // Plain text user message
        input.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // User content blocks — expected to be ToolResultBlock[]
        for (const block of msg.content) {
          const b = block as ToolResultBlock;
          if (b.type === "tool_result") {
            input.push({
              type: "function_call_output",
              call_id: b.tool_use_id,
              output: b.content,
            });
          }
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        input.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Accumulate text parts to combine into a single message,
        // and emit function_call items for tool use blocks.
        let textParts: string[] = [];

        const flushText = () => {
          if (textParts.length > 0) {
            input.push({
              role: "assistant",
              content: textParts.join(""),
            });
            textParts = [];
          }
        };

        for (const block of msg.content) {
          switch (block.type) {
            case "text":
              textParts.push((block as TextBlock).text);
              break;
            case "tool_use": {
              // Flush any accumulated text before adding function call
              flushText();
              const tb = block as ToolUseBlock;
              input.push({
                type: "function_call",
                id: tb.id,
                name: tb.name,
                arguments: JSON.stringify(tb.input),
                call_id: tb.id,
              });
              break;
            }
            case "thinking":
              // Skip thinking blocks — not sent back to the API
              break;
          }
        }

        // Flush remaining text
        flushText();
      }
    }
  }

  return input;
}

// ---------------------------------------------------------------------------
// Response conversion (OpenAI Responses → canonical)
// ---------------------------------------------------------------------------

/** Convert an OpenAI Responses response object to a canonical LLMResponse. */
function convertResponse(response: OpenAI.Responses.Response): LLMResponse {
  const content: ContentBlock[] = [];
  let hasToolCalls = false;

  for (const item of response.output) {
    switch (item.type) {
      case "message": {
        for (const part of item.content) {
          if (part.type === "output_text") {
            content.push({ type: "text", text: part.text });
          }
        }
        break;
      }
      case "function_call": {
        hasToolCalls = true;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(item.arguments) as Record<string, unknown>;
        } catch {
          // If parsing fails, wrap raw string
          parsedArgs = { _raw: item.arguments };
        }
        content.push({
          type: "tool_use",
          id: item.id ?? item.call_id,
          name: item.name,
          input: parsedArgs,
        });
        break;
      }
      case "reasoning": {
        // Reasoning output — collect summary text
        const summaryParts: string[] = [];
        if (item.summary && Array.isArray(item.summary)) {
          for (const s of item.summary) {
            if (s.type === "summary_text") {
              summaryParts.push(s.text);
            }
          }
        }
        if (summaryParts.length > 0) {
          content.push({
            type: "thinking",
            thinking: summaryParts.join(""),
          });
        }
        break;
      }
    }
  }

  // Determine stop reason
  let stop_reason: string;
  if (hasToolCalls) {
    stop_reason = "tool_use";
  } else {
    switch (response.status) {
      case "completed":
        stop_reason = "end_turn";
        break;
      case "incomplete":
        stop_reason = "max_tokens";
        break;
      case "failed":
        stop_reason = "error";
        break;
      default:
        stop_reason = response.status ?? "end_turn";
    }
  }

  // Extract usage
  const usage: TokenUsage = {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };

  return { content, stop_reason, usage };
}

// ---------------------------------------------------------------------------
// OpenAIResponsesStream
// ---------------------------------------------------------------------------

/** Streaming wrapper that consumes OpenAI Responses SSE and emits canonical events. */
export class OpenAIResponsesStream extends EventEmitter implements LLMStream {
  private abortController: AbortController;
  private messagePromise: Promise<LLMResponse>;
  private resolveMessage!: (response: LLMResponse) => void;
  private rejectMessage!: (error: Error) => void;

  constructor(
    streamPromise: Promise<OpenAI.Responses.Response>,
    abortController: AbortController,
    private isStreaming: boolean,
  ) {
    super();
    this.abortController = abortController;

    this.messagePromise = new Promise<LLMResponse>((resolve, reject) => {
      this.resolveMessage = resolve;
      this.rejectMessage = reject;
    });

    if (isStreaming) {
      // streamPromise is actually an async iterable stream
      this.consume(streamPromise as unknown as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>);
    } else {
      // Non-streaming: just await the response
      streamPromise
        .then((response) => {
          const result = convertResponse(response);
          // Emit contentBlock events for each block
          for (const block of result.content) {
            this.emit("contentBlock", block);
          }
          this.resolveMessage(result);
        })
        .catch((err: Error) => this.rejectMessage(err));
    }
  }

  private async consume(
    stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  ): Promise<void> {
    // Yield so callers can attach event listeners before we start consuming
    await Promise.resolve();

    // Track accumulated text for content parts
    let currentText = "";
    let currentThinking = "";

    try {
      for await (const event of stream) {
        switch (event.type as string) {
          // --- Text deltas ---
          case "response.output_text.delta": {
            const delta = (event as any).delta as string;
            if (delta) {
              currentText += delta;
              this.emit("text", delta);
            }
            break;
          }

          // --- Text content done ---
          case "response.output_text.done": {
            const text = (event as any).text as string | undefined;
            const finalText = text ?? currentText;
            if (finalText) {
              const block: TextBlock = { type: "text", text: finalText };
              this.emit("contentBlock", block);
            }
            currentText = "";
            break;
          }

          // --- Reasoning deltas ---
          case "response.reasoning.delta": {
            const delta = (event as any).delta as string;
            if (delta) {
              currentThinking += delta;
              this.emit("thinking", delta);
            }
            break;
          }

          // --- Reasoning done ---
          case "response.reasoning.done": {
            if (currentThinking) {
              const block: ThinkingBlock = {
                type: "thinking",
                thinking: currentThinking,
              };
              this.emit("contentBlock", block);
            }
            currentThinking = "";
            break;
          }

          // --- Function call arguments streaming ---
          case "response.function_call_arguments.delta": {
            // We don't emit partial function call args; wait for done
            break;
          }

          // --- Function call done ---
          case "response.function_call_arguments.done": {
            // The full function call is available on the output_item.done event
            break;
          }

          // --- Output item completed (catches function_call items) ---
          case "response.output_item.done": {
            const item = (event as any).item;
            if (item && item.type === "function_call") {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(item.arguments) as Record<
                  string,
                  unknown
                >;
              } catch {
                parsedArgs = { _raw: item.arguments };
              }
              const block: ToolUseBlock = {
                type: "tool_use",
                id: item.id ?? item.call_id,
                name: item.name,
                input: parsedArgs,
              };
              this.emit("contentBlock", block);
            }
            break;
          }

          // --- Full response completed ---
          case "response.completed": {
            const response = (event as any).response as
              | OpenAI.Responses.Response
              | undefined;
            if (response) {
              const result = convertResponse(response);
              this.resolveMessage(result);
            }
            break;
          }
        }
      }

      // If the stream ended without a response.completed event, build a
      // minimal response from what we accumulated.
      // This is a safety net — normally response.completed fires.
    } catch (err) {
      this.rejectMessage(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  finalMessage(): Promise<LLMResponse> {
    return this.messagePromise;
  }

  abort(): void {
    this.abortController.abort();
  }
}

// ---------------------------------------------------------------------------
// OpenAIResponsesClient
// ---------------------------------------------------------------------------

/** LLMClient implementation backed by the OpenAI Responses API. */
export class OpenAIResponsesClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  async chat(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): Promise<LLMResponse> {
    const model = options.model || DEFAULT_MODEL;
    const input = convertMessages(messages);
    const oaiTools = tools.length > 0 ? tools.map(convertToolDef) : undefined;

    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model,
      input,
      ...(oaiTools && { tools: oaiTools }),
      ...(options.maxTokens && { max_output_tokens: options.maxTokens }),
      ...(options.system && { instructions: options.system }),
    };

    // Reasoning effort
    if (options.effort) {
      params.reasoning = { effort: mapEffort(options.effort) };
    }

    const response = await this.client.responses.create(params, {
      signal: options.signal,
    });

    return convertResponse(response);
  }

  chatStream(
    messages: MessageParam[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const model = options.model || DEFAULT_MODEL;
    const input = convertMessages(messages);
    const oaiTools = tools.length > 0 ? tools.map(convertToolDef) : undefined;
    const abortController = new AbortController();

    // If the caller provided a signal, forward abort
    if (options.signal) {
      options.signal.addEventListener("abort", () => abortController.abort());
    }

    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model,
      input,
      stream: true,
      ...(oaiTools && { tools: oaiTools }),
      ...(options.maxTokens && { max_output_tokens: options.maxTokens }),
      ...(options.system && { instructions: options.system }),
    };

    // Reasoning effort
    if (options.effort) {
      params.reasoning = { effort: mapEffort(options.effort) };
    }

    const streamPromise = this.client.responses.create(params, {
      signal: abortController.signal,
    });

    return new OpenAIResponsesStream(
      streamPromise as unknown as Promise<OpenAI.Responses.Response>,
      abortController,
      true,
    );
  }
}
