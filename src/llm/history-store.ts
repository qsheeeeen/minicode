import type {
  LLMBlock,
  LLMThinkingBlock,
  LLMToolResultBlock,
  LLMToolUseBlock,
} from "./client.js";

type TurnBlocks = LLMBlock[];

function cloneBlock(block: LLMBlock): LLMBlock {
  if (block.type === "tool_use") {
    return { ...block, input: { ...block.input } };
  }
  return { ...block };
}

export function splitHistoryTurns(blocks: LLMBlock[]): LLMBlock[][] {
  const turns: TurnBlocks[] = [];
  let current: TurnBlocks | undefined;

  for (const block of blocks) {
    if (block.type === "user" || !current) {
      current = [];
      turns.push(current);
    }
    current.push(cloneBlock(block));
  }

  return turns;
}

export class LLMHistory {
  private blocks: LLMBlock[] = [];
  private listeners = new Set<() => void>();

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private ensureActiveTurn(): void {
    if (!this.blocks.some((block) => block.type === "user")) {
      throw new Error("No active LLM turn");
    }
  }

  private currentTurnBlocks(): LLMBlock[] {
    this.ensureActiveTurn();
    const start = this.findLastUserIndex();
    return this.blocks.slice(start);
  }

  private findLastUserIndex(): number {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].type === "user") return i;
    }
    return -1;
  }

  private static validateBlocks(blocks: LLMBlock[]): void {
    if (!Array.isArray(blocks)) {
      throw new Error("Invalid LLM history: blocks must be an array");
    }

    let seenUser = false;
    const toolIds = new Set<string>();
    for (const block of blocks) {
      if (!block || typeof block !== "object") {
        throw new Error("Invalid LLM block");
      }

      if (block.type === "user") {
        seenUser = true;
        if (typeof block.text !== "string") {
          throw new Error("Invalid user block: text must be a string");
        }
        continue;
      }

      if (!seenUser) {
        throw new Error("Invalid LLM history: first block must be user");
      }

      if (block.type === "text") {
        if (typeof block.text !== "string") {
          throw new Error("Invalid text block: text must be a string");
        }
      } else if (block.type === "thinking") {
        if (typeof block.thinking !== "string") {
          throw new Error("Invalid thinking block: thinking must be a string");
        }
      } else if (block.type === "tool_use") {
        if (typeof block.id !== "string" || block.id.length === 0) {
          throw new Error("Invalid tool use block: id must be a string");
        }
        if (toolIds.has(block.id)) {
          throw new Error(`Duplicate tool use id: ${block.id}`);
        }
        toolIds.add(block.id);
        if (typeof block.name !== "string" || block.name.length === 0) {
          throw new Error("Invalid tool use block: name must be a string");
        }
        if (
          typeof block.input !== "object" ||
          block.input === null ||
          Array.isArray(block.input)
        ) {
          throw new Error("Invalid tool use block: input must be an object");
        }
      } else if (block.type === "tool_result") {
        if (
          typeof block.tool_use_id !== "string" ||
          block.tool_use_id.length === 0
        ) {
          throw new Error(
            "Invalid tool result block: tool_use_id must be a string",
          );
        }
        if (typeof block.content !== "string") {
          throw new Error(
            "Invalid tool result block: content must be a string",
          );
        }
      } else {
        throw new Error("Invalid LLM block type");
      }
    }
  }

  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getBlocks(): LLMBlock[] {
    return this.blocks.map(cloneBlock);
  }

  getTurns(): LLMBlock[][] {
    return splitHistoryTurns(this.blocks);
  }

  replaceBlocks(blocks: LLMBlock[]): void {
    LLMHistory.validateBlocks(blocks);
    this.blocks = blocks.map(cloneBlock);
    this.notify();
  }

  getTurnCount(): number {
    return this.blocks.filter((block) => block.type === "user").length;
  }

  removeLastTurn(predicate: (turn: LLMBlock[]) => boolean): boolean {
    const turns = splitHistoryTurns(this.blocks);
    const last = turns[turns.length - 1];
    if (!last || !predicate(last)) return false;

    this.blocks = this.blocks.slice(0, this.blocks.length - last.length);
    this.notify();
    return true;
  }

  clear(): void {
    this.blocks = [];
    this.notify();
  }

  startTurn(userText: string): void {
    this.blocks.push({ type: "user", text: userText });
    this.notify();
  }

  appendThinking(delta: string): void {
    this.ensureActiveTurn();
    const last = this.blocks[this.blocks.length - 1];
    if (last?.type === "thinking") {
      last.thinking += delta;
    } else {
      this.blocks.push({ type: "thinking", thinking: delta });
    }
    this.notify();
  }

  startToolCall(
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): void {
    const currentTurn = this.currentTurnBlocks();
    if (
      currentTurn.some(
        (block): block is LLMToolUseBlock =>
          block.type === "tool_use" && block.id === id,
      )
    ) {
      throw new Error(`Duplicate tool use id: ${id}`);
    }
    this.blocks.push({ type: "tool_use", id, name, input });
    this.notify();
  }

  completeToolCall(id: string, result: string): void {
    const currentTurn = this.currentTurnBlocks();
    const hasToolUse = currentTurn.some(
      (block): block is LLMToolUseBlock =>
        block.type === "tool_use" && block.id === id,
    );
    if (!hasToolUse) throw new Error(`Tool use not found: ${id}`);

    const existingResultIndex = this.blocks.findIndex(
      (block): block is LLMToolResultBlock =>
        block.type === "tool_result" && block.tool_use_id === id,
    );
    if (existingResultIndex >= 0) {
      this.blocks[existingResultIndex] = {
        type: "tool_result",
        tool_use_id: id,
        content: result,
      };
    } else {
      this.blocks.push({
        type: "tool_result",
        tool_use_id: id,
        content: result,
      });
    }
    this.notify();
  }

  appendAssistantText(delta: string): void {
    this.ensureActiveTurn();
    const last = this.blocks[this.blocks.length - 1];
    if (last?.type === "text") {
      last.text += delta;
    } else {
      this.blocks.push({ type: "text", text: delta });
    }
    this.notify();
  }
}
