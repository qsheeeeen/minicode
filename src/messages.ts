// Content blocks — provider-agnostic types owned by the message layer.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;
export type UserContentBlock = ToolResultBlock;

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[] | UserContentBlock[];
}

// UI-only status / error messages — not sent to LLM
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

// Display layer — each role carries only the fields it needs
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

// Convert MessageParam[] + statuses → DisplayMessage[]
export function toDisplayMessages(
  turns: MessageParam[],
  statuses: StatusMessage[],
  displayOverrides?: Map<number, string>,
): DisplayMessage[] {
  // Build result map from tool_result blocks
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

  // Index statuses by turnIndex for chronological interleaving
  const byTurnIndex = new Map<number, StatusMessage[]>();
  for (const s of statuses) {
    const idx = s.turnIndex ?? turns.length;
    if (!byTurnIndex.has(idx)) byTurnIndex.set(idx, []);
    byTurnIndex.get(idx)!.push(s);
  }

  const result: DisplayMessage[] = [];

  // Statuses with turnIndex 0 come before all turns
  for (const s of byTurnIndex.get(0) ?? []) {
    result.push({
      role: s.role,
      content: s.content,
      element: s.element,
      toolDisplay: s.toolDisplay,
      timestamp: s.timestamp,
    });
  }

  // Single pass: process turns, interleaving statuses after each
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
    // Statuses added after this turn
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

  // Any unmatched statuses (turnIndex > turns.length) go at the end
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
