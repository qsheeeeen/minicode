import type {
  LLMBlock,
  LLMThinkingBlock,
  LLMToolResultBlock,
  LLMToolUseBlock,
} from "./client.js";

function cloneBlock(block: LLMBlock): LLMBlock {
  if (block.type === "tool_use") {
    return { ...block, input: { ...block.input } };
  }
  return { ...block };
}

export class LLMHistory {
  private blocks: LLMBlock[] = [];
  private listeners = new Set<() => void>();

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private ensureActiveUserMessage(): void {
    if (!this.blocks.some((block) => block.type === "user")) {
      throw new Error("No active user message");
    }
  }

  private currentUserMessageBlocks(): LLMBlock[] {
    this.ensureActiveUserMessage();
    const start = this.findLastUserIndex();
    return this.blocks.slice(start);
  }

  private findLastUserIndex(): number {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].type === "user") return i;
    }
    return -1;
  }

  private findUserOrdinalIndex(ordinal: number): number {
    if (ordinal < 1) return -1;

    let seen = 0;
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i].type !== "user") continue;
      seen++;
      if (seen === ordinal) return i;
    }
    return -1;
  }

  private findNthUserFromEndIndex(count: number): number {
    if (count < 1) return this.blocks.length;

    let seen = 0;
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].type !== "user") continue;
      seen++;
      if (seen === count) return i;
    }
    return 0;
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

  replaceBlocks(blocks: LLMBlock[]): void {
    LLMHistory.validateBlocks(blocks);
    this.blocks = blocks.map(cloneBlock);
    this.notify();
  }

  getUserMessageCount(): number {
    return this.blocks.filter((block) => block.type === "user").length;
  }

  getUserMessages(): string[] {
    return this.blocks
      .filter((block): block is Extract<LLMBlock, { type: "user" }> => {
        return block.type === "user";
      })
      .map((block) => block.text);
  }

  removeFromLastUserMessage(
    predicate: (blocks: LLMBlock[]) => boolean,
  ): boolean {
    const start = this.findLastUserIndex();
    if (start < 0) return false;

    const blocks = this.blocks.slice(start).map(cloneBlock);
    if (!predicate(blocks)) return false;

    this.blocks = this.blocks.slice(0, start);
    this.notify();
    return true;
  }

  truncateBeforeUserMessageOrdinal(ordinal: number): void {
    const start = this.findUserOrdinalIndex(ordinal);
    if (start < 0) {
      if (ordinal <= 1) {
        this.blocks = [];
        this.notify();
      }
      return;
    }

    this.blocks = this.blocks.slice(0, start);
    this.notify();
  }

  splitAtRecentUserMessages(count: number): {
    prefix: LLMBlock[];
    suffix: LLMBlock[];
  } {
    const start = this.findNthUserFromEndIndex(count);
    return {
      prefix: this.blocks.slice(0, start).map(cloneBlock),
      suffix: this.blocks.slice(start).map(cloneBlock),
    };
  }

  clear(): void {
    this.blocks = [];
    this.notify();
  }

  startUserMessage(userText: string): void {
    this.blocks.push({ type: "user", text: userText });
    this.notify();
  }

  appendThinking(delta: string): void {
    this.ensureActiveUserMessage();
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
    const currentUserMessage = this.currentUserMessageBlocks();
    if (
      currentUserMessage.some(
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
    const currentUserMessage = this.currentUserMessageBlocks();
    const hasToolUse = currentUserMessage.some(
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
    this.ensureActiveUserMessage();
    const last = this.blocks[this.blocks.length - 1];
    if (last?.type === "text") {
      last.text += delta;
    } else {
      this.blocks.push({ type: "text", text: delta });
    }
    this.notify();
  }
}
