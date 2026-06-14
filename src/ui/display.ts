import { splitHistoryTurns, type LLMBlock } from "../llm/history.js";

export interface StatusMessage {
  role: "status" | "error";
  content: string;
  timestamp: Date;
  turnIndex?: number;
  element?: unknown;
  toolDisplay?: {
    name: string;
    input: Record<string, unknown>;
    output?: string;
  };
}

export type MessageRole =
  | "user"
  | "text"
  | "thinking"
  | "tool"
  | "status"
  | "error";

export type DisplayMessage =
  | { role: "user"; content: string }
  | { role: "text"; content: string; isStreaming?: boolean }
  | { role: "thinking"; content: string; isStreaming?: boolean }
  | {
      role: "tool";
      name: string;
      input: Record<string, unknown>;
      output?: string;
      slotId: string;
    }
  | {
      role: "status";
      content: string;
      element?: unknown;
      toolDisplay?: {
        name: string;
        input: Record<string, unknown>;
        output?: string;
      };
      timestamp?: Date;
    }
  | { role: "error"; content: string; timestamp?: Date };

export function toDisplayMessages(
  blocks: LLMBlock[],
  statuses: StatusMessage[],
): DisplayMessage[] {
  const turns = splitHistoryTurns(blocks);
  const byTurnIndex = new Map<number, StatusMessage[]>();
  for (const s of statuses) {
    const idx = s.turnIndex ?? turns.length;
    if (!byTurnIndex.has(idx)) byTurnIndex.set(idx, []);
    byTurnIndex.get(idx)!.push(s);
  }

  const result: DisplayMessage[] = [];

  for (const s of byTurnIndex.get(0) ?? []) {
    result.push({
      role: s.role,
      content: s.content,
      element: s.element,
      toolDisplay: s.toolDisplay,
      timestamp: s.timestamp,
    });
  }

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const toolMessages = new Map<
      string,
      Extract<DisplayMessage, { role: "tool" }>
    >();
    for (const block of turn) {
      if (block.type === "user") {
        result.push({ role: "user", content: block.text });
      } else if (block.type === "text") {
        result.push({ role: "text", content: block.text });
      } else if (block.type === "thinking") {
        result.push({ role: "thinking", content: block.thinking });
      } else if (block.type === "tool_use") {
        const message: Extract<DisplayMessage, { role: "tool" }> = {
          role: "tool",
          name: block.name,
          input: block.input,
          slotId: block.id,
        };
        toolMessages.set(block.id, message);
        result.push(message);
      } else if (block.type === "tool_result") {
        const message = toolMessages.get(block.tool_use_id);
        if (message) message.output = block.content;
      }
    }
    for (const s of byTurnIndex.get(i + 1) ?? []) {
      result.push({
        role: s.role,
        content: s.content,
        element: s.element,
        toolDisplay: s.toolDisplay,
        timestamp: s.timestamp,
      });
    }
  }

  for (const s of statuses) {
    const idx = s.turnIndex;
    if (idx !== undefined && idx > turns.length) {
      result.push({
        role: s.role,
        content: s.content,
        element: s.element,
        toolDisplay: s.toolDisplay,
        timestamp: s.timestamp,
      });
    }
  }

  return result;
}
