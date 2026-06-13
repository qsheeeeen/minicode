import type { DisplayMessage, StatusMessage } from "./display.js";
import type { ContextTurn } from "./turns.js";

export function toDisplayMessages(
  turns: ContextTurn[],
  statuses: StatusMessage[],
): DisplayMessage[] {
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
    result.push({ role: "user", content: turn.userText });
    for (const block of turn.process) {
      if (block.type === "thinking") {
        result.push({ role: "thinking", content: block.thinking });
      } else if (block.type === "tool_call") {
        result.push({
          role: "tool",
          name: block.name,
          input: block.input,
          output: block.result,
          slotId: block.id,
        });
      }
    }
    if (turn.assistantText) {
      result.push({ role: "text", content: turn.assistantText });
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
