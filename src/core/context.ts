import type {
  LLMMediaType,
  LLMImage,
  LLMBlock,
  LLMToolResultBlock,
  LLMToolUseBlock,
} from "./blocks.js";

const MEDIA_TYPES: readonly LLMMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

function isValidImages(images: unknown): boolean {
  if (!Array.isArray(images)) return false;
  return images.every(
    (img) =>
      img !== null &&
      typeof img === "object" &&
      MEDIA_TYPES.includes((img as LLMImage).mediaType) &&
      typeof (img as LLMImage).base64 === "string" &&
      (img as LLMImage).base64.length > 0,
  );
}

function cloneBlock(block: LLMBlock): LLMBlock {
  if (block.type === "tool_use") {
    return { ...block, input: { ...block.input } };
  }
  if (block.type === "tool_result" && block.images) {
    return { ...block, images: block.images.slice() };
  }
  return { ...block };
}

export class LLMContext {
  private blocks: LLMBlock[] = [];
  private listeners = new Set<() => void>();
  // Maintained incrementally so the per-token append paths never rescan.
  private userCount = 0;
  private toolUseCount = 0;

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private recount(): void {
    this.userCount = 0;
    this.toolUseCount = 0;
    for (const block of this.blocks) {
      if (block.type === "user") this.userCount++;
      else if (block.type === "tool_use") this.toolUseCount++;
    }
  }

  private ensureActiveUserMessage(): void {
    if (this.userCount === 0) {
      throw new Error("No active user message");
    }
  }

  /** Test a predicate over the current (last) user message's blocks without
   *  slicing — the per-tool-call guards run on every tool call. */
  private currentMessageHas(pred: (block: LLMBlock) => boolean): boolean {
    this.ensureActiveUserMessage();
    for (let i = this.findLastUserIndex(); i < this.blocks.length; i++) {
      if (pred(this.blocks[i])) return true;
    }
    return false;
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
      throw new Error("Invalid LLM context: blocks must be an array");
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
        throw new Error("Invalid LLM context: first block must be user");
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
        if (block.images !== undefined && !isValidImages(block.images)) {
          throw new Error(
            "Invalid tool result block: images must be { mediaType, base64 }[]",
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

  /** Read view for projections, persistence, and protocol serialization.
   *  O(1): callers must not mutate the blocks or the array. */
  getBlocksReadonly(): readonly LLMBlock[] {
    return this.blocks;
  }

  /** Ownership copy — for callers that rework the blocks (compression). */
  getBlocks(): LLMBlock[] {
    return this.blocks.map(cloneBlock);
  }

  replaceBlocks(blocks: LLMBlock[]): void {
    LLMContext.validateBlocks(blocks);
    this.blocks = blocks.map(cloneBlock);
    this.recount();
    this.notify();
  }

  getUserMessageCount(): number {
    return this.userCount;
  }

  getToolUseCount(): number {
    return this.toolUseCount;
  }

  getUserMessages(): string[] {
    return this.blocks
      .filter((block): block is Extract<LLMBlock, { type: "user" }> => {
        return block.type === "user";
      })
      .map((block) => block.text);
  }

  truncateBeforeUserMessageOrdinal(ordinal: number): void {
    const start = this.findUserOrdinalIndex(ordinal);
    if (start < 0) {
      if (ordinal <= 1) {
        this.blocks = [];
        this.recount();
        this.notify();
      }
      return;
    }

    this.blocks = this.blocks.slice(0, start);
    this.recount();
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
    this.recount();
    this.notify();
  }

  startUserMessage(userText: string): void {
    this.blocks.push({ type: "user", text: userText });
    this.userCount++;
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
    if (
      this.currentMessageHas(
        (block): block is LLMToolUseBlock =>
          block.type === "tool_use" && block.id === id,
      )
    ) {
      throw new Error(`Duplicate tool use id: ${id}`);
    }
    this.blocks.push({ type: "tool_use", id, name, input });
    this.toolUseCount++;
    this.notify();
  }

  completeToolCall(id: string, result: string, images?: LLMImage[]): void {
    const hasToolUse = this.currentMessageHas(
      (block): block is LLMToolUseBlock =>
        block.type === "tool_use" && block.id === id,
    );
    if (!hasToolUse) throw new Error(`Tool use not found: ${id}`);

    const block: LLMToolResultBlock = {
      type: "tool_result",
      tool_use_id: id,
      content: result,
      ...(images && images.length > 0 ? { images } : {}),
    };
    const existingResultIndex = this.blocks.findIndex(
      (b): b is LLMToolResultBlock =>
        b.type === "tool_result" && b.tool_use_id === id,
    );
    if (existingResultIndex >= 0) {
      this.blocks[existingResultIndex] = block;
    } else {
      this.blocks.push(block);
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
