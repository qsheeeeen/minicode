import type { LLMBlock } from "../core/blocks.js";
import type {
  RuntimeStatus,
  ToolDisplayPayload,
} from "../services/runtime-events.js";

export type StatusMessage = RuntimeStatus;

export type DisplayMessage =
  | { role: "user"; content: string }
  | { role: "text"; content: string }
  | { role: "thinking"; content: string }
  | (ToolDisplayPayload & {
      role: "tool";
      /** Pairs the tool_use with its tool_result for output backfill. */
      slotId: string;
    })
  // Statuses flow through unchanged except for the placement index —
  // display order comes from interleaving below, not from the field.
  | Omit<RuntimeStatus, "userMessageIndex" | "toolDisplay">;

/** Strip the placement index; a status carrying a tool payload becomes a
 *  plain tool message so the renderers only know one tool shape. */
function toStatusDisplay(s: StatusMessage, slotId: string): DisplayMessage {
  if (s.toolDisplay) {
    return { role: "tool", ...s.toolDisplay, slotId };
  }
  const { userMessageIndex: _placed, toolDisplay: _tool, ...msg } = s;
  return msg;
}

export function toDisplayMessages(
  blocks: readonly LLMBlock[],
  statuses: StatusMessage[],
  displays?: Map<number, string>,
): DisplayMessage[] {
  const userMessageCount = blocks.filter(
    (block) => block.type === "user",
  ).length;

  // Bucket statuses by the user message they follow; unindexed ones belong
  // after the latest. Statuses indexed past the end (a user message that
  // doesn't exist yet) carry over to the very end of the transcript.
  // `statuses` is append-only, so its indexes make stable slot ids.
  const byUserMessageIndex = new Map<number, [StatusMessage, string][]>();
  const trailing: [StatusMessage, string][] = [];
  for (let i = 0; i < statuses.length; i++) {
    const s = statuses[i];
    const slotId = `status-${i}`;
    const idx = s.userMessageIndex ?? userMessageCount;
    if (idx > userMessageCount) {
      trailing.push([s, slotId]);
    } else {
      const bucket = byUserMessageIndex.get(idx);
      if (bucket) bucket.push([s, slotId]);
      else byUserMessageIndex.set(idx, [[s, slotId]]);
    }
  }

  const result: DisplayMessage[] = [];
  const pushStatuses = (idx: number): void => {
    for (const [s, slotId] of byUserMessageIndex.get(idx) ?? []) {
      result.push(toStatusDisplay(s, slotId));
    }
  };

  pushStatuses(0);

  let userMessagesSeen = 0;
  let toolMessages = new Map<
    string,
    Extract<DisplayMessage, { role: "tool" }>
  >();

  for (const block of blocks) {
    if (block.type === "user") {
      if (userMessagesSeen > 0) pushStatuses(userMessagesSeen);
      result.push({
        role: "user",
        content: displays?.get(userMessagesSeen) ?? block.text,
      });
      userMessagesSeen++;
      toolMessages = new Map();
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

  if (userMessagesSeen > 0) pushStatuses(userMessagesSeen);
  for (const [s, slotId] of trailing) result.push(toStatusDisplay(s, slotId));

  return result;
}
