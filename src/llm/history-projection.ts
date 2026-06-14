import type {
  LLMAssistantBlock,
  LLMBlock,
  LLMMessage,
  LLMToolResultBlock,
} from "./client.js";

export function historyToLLMMessages(blocks: LLMBlock[]): LLMMessage[] {
  const messages: LLMMessage[] = [];
  let assistantBlocks: LLMAssistantBlock[] = [];

  const flushAssistant = () => {
    if (assistantBlocks.length === 0) return;
    messages.push({ role: "assistant", content: assistantBlocks });
    assistantBlocks = [];
  };

  for (const block of blocks) {
    if (block.type === "user") {
      flushAssistant();
      messages.push({ role: "user", content: block.text });
    } else if (block.type === "tool_result") {
      flushAssistant();
      const resultBlock: LLMToolResultBlock = {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
      };
      messages.push({ role: "user", content: [resultBlock] });
    } else {
      assistantBlocks.push(block);
    }
  }

  flushAssistant();
  return messages;
}
