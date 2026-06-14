import type { ContextTurn } from "../context/index.js";
import type { LLMMessage, LLMAssistantBlock } from "./client.js";

export function contextToLLMMessages(turns: ContextTurn[]): LLMMessage[] {
  const messages: LLMMessage[] = [];

  for (const turn of turns) {
    messages.push({ role: "user", content: turn.userText });

    let assistantBlocks: LLMAssistantBlock[] = [];
    const flushAssistant = () => {
      if (assistantBlocks.length === 0) return;
      messages.push({ role: "assistant", content: assistantBlocks });
      assistantBlocks = [];
    };

    for (const block of turn.process) {
      if (block.type === "thinking") {
        assistantBlocks.push({ type: "thinking", thinking: block.thinking });
      } else {
        assistantBlocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
        flushAssistant();
        if (block.result !== undefined) {
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: block.id,
                content: block.result,
              },
            ],
          });
        }
      }
    }

    if (turn.assistantText) {
      assistantBlocks.push({ type: "text", text: turn.assistantText });
    }
    flushAssistant();
  }

  return messages;
}
