import type { ContentBlock, MessageParam } from "./types.js";
import type { DisplayMessage, StatusMessage } from "./display.js";

export function toDisplayMessages(
  turns: MessageParam[],
  statuses: StatusMessage[],
  displayOverrides?: Map<number, string>,
): DisplayMessage[] {
  const results = new Map<string, string>();
  for (const turn of turns) {
    if (turn.role === "user" && Array.isArray(turn.content)) {
      for (const block of turn.content) {
        if (block.type === "tool_result") {
          results.set(
            block.tool_use_id,
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
          );
        }
      }
    }
  }

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
    if (turn.role === "user") {
      if (typeof turn.content === "string") {
        const displayContent = displayOverrides?.get(i) ?? turn.content;
        result.push({ role: "user", content: displayContent });
      }
    } else if (turn.role === "assistant") {
      const blocks = Array.isArray(turn.content) ? turn.content : [];
      for (const block of blocks as ContentBlock[]) {
        if (block.type === "thinking") {
          result.push({ role: "thinking", content: block.thinking });
        } else if (block.type === "text") {
          result.push({ role: "text", content: block.text });
        } else if (block.type === "tool_use") {
          result.push({
            role: "tool",
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
            output: results.get(block.id),
            slotId: block.id,
          });
        }
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
    if (s.turnIndex !== undefined && s.turnIndex > turns.length) {
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
