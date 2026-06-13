import type {
  AssistantBlock,
  ContextBlock,
  ContentBlock,
  ToolResultBlock,
  UserContentBlock,
} from "./blocks.js";

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[] | UserContentBlock[];
}

export interface ContextTurn {
  userText: string;
  displayUserText?: string;
  blocks: ContextBlock[];
}

function ensureCurrentTurn(current: ContextTurn | undefined): ContextTurn {
  return current ?? { userText: "", blocks: [] };
}

export function groupMessagesIntoContextTurns(
  messages: MessageParam[],
  displayOverrides?: Map<number, string>,
): ContextTurn[] {
  const turns: ContextTurn[] = [];
  let current: ContextTurn | undefined;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (message.role === "user" && typeof message.content === "string") {
      if (current) turns.push(current);
      current = {
        userText: message.content,
        displayUserText: displayOverrides?.get(i),
        blocks: [],
      };
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      current = ensureCurrentTurn(current);
      current.blocks.push(...(message.content as AssistantBlock[]));
      continue;
    }

    if (message.role === "user" && Array.isArray(message.content)) {
      current = ensureCurrentTurn(current);
      current.blocks.push(...(message.content as ToolResultBlock[]));
    }
  }

  if (current) turns.push(current);
  return turns;
}
