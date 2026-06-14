// OpenAI Responses API adapter.
//
// Implements the provider-agnostic LLMClient / LLMStream interfaces, converting
// between internal types and the OpenAI Responses API format.
//
// The Responses API (`client.responses.create()`) uses a flat `input` array
// of items rather than the chat-completions message array.

import OpenAI from "openai";

import type {
  LLMClient,
  LLMStream,
  StreamEvent,
  LLMToolDef,
  ChatOptions,
  LLMResponse,
  TokenUsage,
  EffortLevel,
} from "./client.js";
import type {
  ProviderMessage,
  ProviderAssistantBlock,
  ProviderTextBlock,
  ProviderToolUseBlock,
  ProviderToolResultBlock,
} from "./client.js";

// The OpenAI SDK's ResponseStreamEvent union doesn't cover all streaming event
// types (delta, output_item.done, etc.). These interfaces fill the gap.
interface StreamDeltaEvent {
  delta: string;
}

interface StreamOutputItemDoneEvent {
  item: {
    type: string;
    id?: string;
    call_id?: string;
    name: string;
    arguments: string;
  };
}

interface StreamCompletedEvent {
  response: OpenAI.Responses.Response;
}

// Constants

const DEFAULT_MODEL = "gpt-4.1";

// Effort mapping

// Map our five-level effort to OpenAI's three-level reasoning effort.
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

// Tool definition conversion

// Convert LLMToolDef[] to OpenAI Responses function tools.
function toSdkTools(tools: LLMToolDef[]): OpenAI.Responses.FunctionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema as OpenAI.FunctionParameters,
    strict: false,
  }));
}

// Message conversion (internal → OpenAI Responses input)

type ResponseInputItem = OpenAI.Responses.ResponseInputItem;

// Convert ProviderMessage[] to an OpenAI Responses `input` array.
function toSdkMessages(messages: ProviderMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        // Plain text user message
        input.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // User content blocks — expected to be ProviderToolResultBlock[]
        for (const block of msg.content) {
          const b = block as ProviderToolResultBlock;
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
              textParts.push((block as ProviderTextBlock).text);
              break;
            case "tool_use": {
              // Flush any accumulated text before adding function call
              flushText();
              const tb = block as ProviderToolUseBlock;
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

// Response conversion (SDK → internal)

// Convert an OpenAI Responses response object to LLMResponse.
function toLLMResponse(response: OpenAI.Responses.Response): LLMResponse {
  const content: ProviderAssistantBlock[] = [];
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
    input: {
      total: response.usage?.input_tokens ?? 0,
      cache_miss: 0,
      cache_hit: 0,
    },
    output: response.usage?.output_tokens ?? 0,
  };

  return { content, stop_reason, usage };
}

// OpenAIResponsesClient

// LLMClient implementation backed by the OpenAI Responses API.
export class OpenAIResponsesClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  chatStream(
    messages: ProviderMessage[],
    tools: LLMToolDef[],
    options: ChatOptions = {},
  ): LLMStream {
    const model = options.model?.getName() || DEFAULT_MODEL;
    const input = toSdkMessages(messages);
    const oaiTools = tools.length > 0 ? toSdkTools(tools) : undefined;
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
    const effort = options.model?.getEffort();
    if (effort) {
      params.reasoning = { effort: toSdkEffort(effort) };
    }

    const streamPromise = this.client.responses.create(params, {
      signal: abortController.signal,
    }) as unknown as Promise<
      AsyncIterable<OpenAI.Responses.ResponseStreamEvent>
    >;

    async function* run(): AsyncGenerator<StreamEvent, LLMResponse, unknown> {
      const stream = await streamPromise;

      let currentText = "";
      let currentThinking = "";
      let finalResult: LLMResponse | null = null;

      for await (const event of stream) {
        switch (event.type as string) {
          case "response.output_text.delta": {
            const delta = (event as unknown as StreamDeltaEvent).delta;
            if (delta) {
              currentText += delta;
              yield { type: "text", text: delta };
            }
            break;
          }
          case "response.output_text.done": {
            currentText = "";
            break;
          }
          case "response.reasoning.delta": {
            const delta = (event as unknown as StreamDeltaEvent).delta;
            if (delta) {
              currentThinking += delta;
              yield { type: "thinking", thinking: delta };
            }
            break;
          }
          case "response.reasoning.done": {
            currentThinking = "";
            break;
          }
          case "response.output_item.done": {
            const item = (event as unknown as StreamOutputItemDoneEvent).item;
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
              yield {
                type: "tool_use",
                block: {
                  type: "tool_use",
                  id: item.id ?? item.call_id ?? "",
                  name: item.name,
                  input: parsedArgs,
                },
              };
            }
            break;
          }
          case "response.completed": {
            const response = (event as unknown as StreamCompletedEvent)
              .response;
            if (response) {
              finalResult = toLLMResponse(response);
            }
            break;
          }
        }
      }

      if (finalResult) {
        return finalResult;
      }

      // Fallback if completed event didn't fire properly
      return {
        content: [],
        stop_reason: "error",
        usage: { input: { total: 0, cache_miss: 0, cache_hit: 0 }, output: 0 },
      };
    }

    return run();
  }
}
