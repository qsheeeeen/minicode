// Virtual LLM protocol for testing.
//
// Implements LLMClient with scriptable responses. Uses real async generators
// (not hand-rolled objects) to match the exact streaming contract of production
// adapters. Supports abort signals, artificial delays, and sequential response
// consumption.

import type {
  LLMClient,
  LLMStream,
  LLMStreamResult,
  LLMToolDef,
  ChatOptions,
  TokenUsage,
  LLMAssistantBlock,
  LLMBlock,
} from "../llm/client.js";

// Types

export interface ScriptedResponse {
  events: LLMAssistantBlock[];
  result: LLMStreamResult;
}

export interface VirtualLLMOptions {
  /** Throw when all scripted responses are consumed (default: true) */
  exhaustThrows?: boolean;
  /** Artificial delay per yield in ms (default: 0) */
  yieldDelayMs?: number;
}

// Default usage for convenience constructors

const DEFAULT_USAGE: TokenUsage = {
  input: { total: 100, cache_miss: 50, cache_hit: 50 },
  output: 10,
};

// Virtual LLM Client

export class VirtualLLMClient implements LLMClient {
  private callIndex = 0;
  private readonly responses: ScriptedResponse[];
  private readonly exhaustThrows: boolean;
  private readonly yieldDelayMs: number;

  constructor(responses: ScriptedResponse[], options?: VirtualLLMOptions) {
    this.responses = responses;
    this.exhaustThrows = options?.exhaustThrows ?? true;
    this.yieldDelayMs = options?.yieldDelayMs ?? 0;
  }

  chatStream(
    _blocks: LLMBlock[],
    _tools: LLMToolDef[],
    options?: ChatOptions,
  ): LLMStream {
    if (this.callIndex >= this.responses.length) {
      if (this.exhaustThrows) {
        throw new Error(
          `VirtualLLMClient: no more scripted responses (call ${this.callIndex + 1} of ${this.responses.length} provided)`,
        );
      }
      return this.emptyStream();
    }
    const scripted = this.responses[this.callIndex++];
    return this.createStream(scripted, options?.signal);
  }

  private async *createStream(
    scripted: ScriptedResponse,
    signal?: AbortSignal,
  ): LLMStream {
    for (const event of scripted.events) {
      if (signal?.aborted) throw new Error("Aborted");
      if (this.yieldDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.yieldDelayMs));
      }
      yield event;
    }
    return scripted.result;
  }

  private async *emptyStream(): LLMStream {
    return {
      content: [],
      stop_reason: "end_turn",
      usage: { input: { total: 0, cache_miss: 0, cache_hit: 0 }, output: 0 },
    };
  }

  // Static convenience constructors

  static textResponse(text: string): ScriptedResponse {
    return {
      events: [{ type: "text", text }],
      result: {
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: DEFAULT_USAGE,
      },
    };
  }

  static toolUseResponse(
    toolId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): ScriptedResponse {
    return {
      events: [
        { type: "tool_use", id: toolId, name: toolName, input },
      ],
      result: {
        content: [{ type: "tool_use", id: toolId, name: toolName, input }],
        stop_reason: "tool_use",
        usage: DEFAULT_USAGE,
      },
    };
  }
}

// Standalone convenience functions

export function defaultTextResponse(text: string): ScriptedResponse {
  return VirtualLLMClient.textResponse(text);
}

export function toolUseResponse(
  toolId: string,
  toolName: string,
  input: Record<string, unknown>,
): ScriptedResponse {
  return VirtualLLMClient.toolUseResponse(toolId, toolName, input);
}
