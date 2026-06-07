import type { LLMClient, LLMStream, LLMResponse } from "../llm/client.js";
import type { ContentBlock, ToolUseBlock } from "../messages.js";
import type { ToolDef } from "../tools/index.js";
import type { MessageStore } from "../messages.js";

export interface StreamingResult {
  response: LLMResponse;
  toolCalls: Array<{
    block: ToolUseBlock;
    tool?: ToolDef;
  }>;
}

type TextField = "thinking" | "text";

export class StreamingHandler {
  constructor(
    private store: MessageStore,
    private tools: Map<string, ToolDef>,
    private saveStore: () => void,
  ) {}

  async handle(
    client: LLMClient,
    messages: Parameters<LLMClient["chatStream"]>[0],
    toolDefs: Parameters<LLMClient["chatStream"]>[1],
    options: Parameters<LLMClient["chatStream"]>[2],
    signal?: AbortSignal,
    currentStreamRef?: { current: any },
  ): Promise<StreamingResult> {
    const stream = client.chatStream(messages, toolDefs, options);
    if (currentStreamRef) currentStreamRef.current = stream;

    let blockStreaming = false;
    const toolCalls: StreamingResult["toolCalls"] = [];

    const handleDelta = (field: TextField, delta: string) => {
      const block =
        field === "thinking"
          ? { type: "thinking" as const, thinking: delta.trimStart() }
          : { type: "text" as const, text: delta.trimStart() };
      if (!blockStreaming) {
        blockStreaming = true;
        this.store.setStreaming(true);
        this.store.appendToLastAssistantTurn(block as ContentBlock);
      } else {
        const last = this.store.getLastBlock();
        if (last?.type === field && field in last) {
          const currentText = (last as any)[field] as string;
          const newText = currentText === "" ? delta.trimStart() : delta;
          this.store.updateLastBlock({ [field]: currentText + newText });
        } else {
          this.store.appendToLastAssistantTurn(block as ContentBlock);
        }
      }
    };

    let response: LLMResponse | undefined;
    try {
      while (true) {
        if (signal?.aborted) throw new Error("Aborted");

        const next = await stream.next();
        if (next.done) {
          response = next.value as LLMResponse;
          break;
        }

        const chunk = next.value;
        if (chunk.type === "text" || chunk.type === "thinking") {
          // @ts-expect-error - text or thinking fields exist based on type
          handleDelta(chunk.type, chunk[chunk.type]);
        } else if (chunk.type === "tool_use") {
          const block = chunk.block;
          blockStreaming = false;
          const tool = this.tools.get(block.name);
          toolCalls.push({ block, tool });
          this.store.appendToLastAssistantTurn(block as ContentBlock);
          this.saveStore();
        }
      }

      if (signal?.aborted) throw new Error("Aborted");
      if (!response) {
        throw new Error("Stream closed without returning a response");
      }
    } catch (e) {
      if (signal?.aborted) throw new Error("Aborted");
      throw e;
    } finally {
      this.saveStore();
      if (currentStreamRef) currentStreamRef.current = null;
      this.store.setStreaming(false);
    }

    return {
      response,
      toolCalls,
    };
  }
}
