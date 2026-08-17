import type { LLMBlock } from "../core/blocks.js";
import type { RuntimeStatus } from "../services/runtime-events.js";

export type StatusMessage = RuntimeStatus;

export type MessageRole =
  | "user"
  | "text"
  | "thinking"
  | "tool"
  | "status"
  | "error";

export type DisplayMessage =
  | { role: "user"; content: string }
  | { role: "text"; content: string }
  | { role: "thinking"; content: string }
  | {
      role: "tool";
      name: string;
      input: Record<string, unknown>;
      output?: string;
      slotId: string;
    }
  // Statuses flow through unchanged except for the placement index —
  // display order comes from interleaving below, not from the field.
  | Omit<RuntimeStatus, "userMessageIndex">;

/** Strip the placement index; keep everything else as-is. */
function toStatusDisplay({
  userMessageIndex: _placed,
  ...msg
}: StatusMessage): DisplayMessage {
  return msg;
}

export function toDisplayMessages(
  blocks: LLMBlock[],
  statuses: StatusMessage[],
  displays?: Map<number, string>,
): DisplayMessage[] {
  const userMessageCount = blocks.filter(
    (block) => block.type === "user",
  ).length;

  // Bucket statuses by the user message they follow; unindexed ones belong
  // after the latest. Statuses indexed past the end (a user message that
  // doesn't exist yet) carry over to the very end of the transcript.
  const byUserMessageIndex = new Map<number, StatusMessage[]>();
  const trailing: StatusMessage[] = [];
  for (const s of statuses) {
    const idx = s.userMessageIndex ?? userMessageCount;
    if (idx > userMessageCount) {
      trailing.push(s);
    } else {
      const bucket = byUserMessageIndex.get(idx);
      if (bucket) bucket.push(s);
      else byUserMessageIndex.set(idx, [s]);
    }
  }

  const result: DisplayMessage[] = [];
  const pushStatuses = (idx: number): void => {
    for (const s of byUserMessageIndex.get(idx) ?? []) {
      result.push(toStatusDisplay(s));
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
  for (const s of trailing) result.push(toStatusDisplay(s));

  return result;
}
