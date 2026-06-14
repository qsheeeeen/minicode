import type {
  LLMAssistantBlock,
  LLMBlock,
  LLMToolResultBlock,
} from "../client.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | LLMAssistantBlock[] | LLMToolResultBlock[];
}

export function blocksToChatMessages(blocks: LLMBlock[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
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
