import type { ContextTurn } from "./turns.js";
import type { ProcessBlock, ToolCallBlock } from "./blocks.js";

export class ContextStore {
  private turns: ContextTurn[] = [];
  private listeners = new Set<() => void>();

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private currentTurn(): ContextTurn {
    const turn = this.turns[this.turns.length - 1];
    if (!turn) throw new Error("No active context turn");
    return turn;
  }

  private static cloneTurn(turn: ContextTurn): ContextTurn {
    return {
      userText: turn.userText,
      assistantText: turn.assistantText,
      process: turn.process.map((block) =>
        block.type === "thinking"
          ? { ...block }
          : {
              ...block,
              input: { ...block.input },
            },
      ),
    };
  }

  private static validateTurn(turn: ContextTurn): void {
    if (typeof turn.userText !== "string") {
      throw new Error("Invalid context turn: userText must be a string");
    }
    if (!Array.isArray(turn.process)) {
      throw new Error("Invalid context turn: process must be an array");
    }
    if (
      turn.assistantText !== undefined &&
      typeof turn.assistantText !== "string"
    ) {
      throw new Error("Invalid context turn: assistantText must be a string");
    }

    const toolIds = new Set<string>();
    for (const block of turn.process as ProcessBlock[]) {
      if (block.type === "thinking") {
        if (typeof block.thinking !== "string") {
          throw new Error("Invalid thinking block: thinking must be a string");
        }
        continue;
      }

      if (block.type !== "tool_call") {
        throw new Error("Invalid process block type");
      }
      if (typeof block.id !== "string" || block.id.length === 0) {
        throw new Error("Invalid tool call block: id must be a string");
      }
      if (toolIds.has(block.id)) {
        throw new Error(`Duplicate tool call id: ${block.id}`);
      }
      toolIds.add(block.id);
      if (typeof block.name !== "string" || block.name.length === 0) {
        throw new Error("Invalid tool call block: name must be a string");
      }
      if (
        typeof block.input !== "object" ||
        block.input === null ||
        Array.isArray(block.input)
      ) {
        throw new Error("Invalid tool call block: input must be an object");
      }
      if (block.result !== undefined && typeof block.result !== "string") {
        throw new Error("Invalid tool call block: result must be a string");
      }
    }
  }

  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getTurns(): ContextTurn[] {
    return this.turns.map(ContextStore.cloneTurn);
  }

  getTurnCount(): number {
    return this.turns.length;
  }

  replaceTurns(turns: ContextTurn[]): void {
    for (const turn of turns) ContextStore.validateTurn(turn);
    this.turns = turns.map(ContextStore.cloneTurn);
    this.notify();
  }

  removeLastTurn(predicate: (turn: ContextTurn) => boolean): boolean {
    const last = this.turns[this.turns.length - 1];
    if (last && predicate(ContextStore.cloneTurn(last))) {
      this.turns.pop();
      this.notify();
      return true;
    }
    return false;
  }

  clear(): void {
    this.turns = [];
    this.notify();
  }

  startTurn(userText: string): void {
    this.turns.push({ userText, process: [] });
    this.notify();
  }

  appendThinking(delta: string): void {
    const turn = this.currentTurn();
    const last = turn.process[turn.process.length - 1];
    if (last?.type === "thinking") {
      last.thinking += delta;
    } else {
      turn.process.push({ type: "thinking", thinking: delta });
    }
    this.notify();
  }

  startToolCall(
    id: string,
    name: string,
    input: Record<string, unknown>,
  ): void {
    const turn = this.currentTurn();
    if (
      turn.process.some(
        (block): block is ToolCallBlock =>
          block.type === "tool_call" && block.id === id,
      )
    ) {
      throw new Error(`Duplicate tool call id: ${id}`);
    }
    turn.process.push({ type: "tool_call", id, name, input });
    this.notify();
  }

  completeToolCall(id: string, result: string): void {
    const turn = this.currentTurn();
    const block = turn.process.find(
      (item): item is ToolCallBlock =>
        item.type === "tool_call" && item.id === id,
    );
    if (!block) throw new Error(`Tool call not found: ${id}`);
    block.result = result;
    this.notify();
  }

  appendAssistantText(delta: string): void {
    const turn = this.currentTurn();
    turn.assistantText = (turn.assistantText ?? "") + delta;
    this.notify();
  }
}
