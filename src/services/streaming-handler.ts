import type { LLMClient, LLMStream } from "../llm/client.js";
import type { ContentBlock, LLMResponse } from "../llm/types.js";
import type { ToolDef } from "../tools/index.js";
import type { MessageStore } from "../messages.js";

export interface StreamingResult {
  response: LLMResponse;
  toolCalls: Array<{ block: ContentBlock & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }; tool?: ToolDef }>;
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
      const block = field === "thinking"
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

    stream.on("thinking", (delta: string) => handleDelta("thinking", delta));
    stream.on("text", (delta: string) => handleDelta("text", delta));

    stream.on("contentBlock", (block: ContentBlock) => {
      blockStreaming = false;
      if (block.type === "thinking" || block.type === "text") {
        this.saveStore();
      }
      if (block.type === "tool_use") {
        const toolBlock = block as ContentBlock & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
        const tool = this.tools.get(toolBlock.name);
        toolCalls.push({ block: toolBlock, tool });
        this.store.appendToLastAssistantTurn({
          type: "tool_use",
          id: toolBlock.id,
          name: toolBlock.name,
          input: toolBlock.input,
        } as ContentBlock);
        this.saveStore();
      }
    });

    let response: LLMResponse;
    try {
      const messagePromise = stream.finalMessage();
      if (signal?.aborted) throw new Error("Aborted");

      response = await new Promise<LLMResponse>(
        (resolve, reject) => {
          let settled = false;
          const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

          const onAbort = () => {
            signal!.removeEventListener("abort", onAbort);
            clearTimeout(timer);
            done(() => reject(new Error("Aborted")));
          };
          signal?.addEventListener("abort", onAbort);

          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            done(() => reject(new Error("LLM request timed out")));
          }, 300_000);

          messagePromise.then(
            (val) => {
              signal?.removeEventListener("abort", onAbort);
              clearTimeout(timer);
              done(() => resolve(val));
            },
            (err) => {
              signal?.removeEventListener("abort", onAbort);
              clearTimeout(timer);
              done(() => reject(err));
            },
          );
        },
      );
    } catch (e) {
      if (signal?.aborted) throw new Error("Aborted");
      throw e;
    } finally {
      if (currentStreamRef) currentStreamRef.current = null;
      this.store.setStreaming(false);
    }

    return {
      response,
      toolCalls,
    };
  }
}
