import type { StatusMessage } from "./display.js";
import type { LLMBlock, LLMHistory } from "../llm/history.js";

/**
 * HeadlessRenderer — incremental stdout renderer for non-TUI mode.
 *
 * It renders the LLMHistory block stream directly.
 */
export class HeadlessRenderer {
  private context: LLMHistory;
  private statuses: StatusMessage[] = [];
  private printedBlocks = 0;
  private streamedChars = new Map<number, number>();
  private finalizedBlocks = new Set<number>();
  private printedToolUses = new Set<string>();
  private printedResults = new Set<string>();
  private lastStatusIdx = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(context: LLMHistory) {
    this.context = context;
  }

  addStatus(msg: StatusMessage): void {
    this.statuses.push(msg);
  }

  start(): void {
    this.unsubscribe = this.context.onChange(() => this.render(false));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  renderFinal(): void {
    this.render(true);
  }

  render(isFinal = false): void {
    const blocks = this.context.getBlocks();
    const stableCount = this.getStableBlockCount(blocks, isFinal);

    for (let i = this.printedBlocks; i < blocks.length; i++) {
      this.renderBlock(blocks[i], i, i < stableCount, isFinal);
    }
    this.printedBlocks = stableCount;

    this.renderStatuses();
  }

  private getStableBlockCount(blocks: LLMBlock[], isFinal: boolean): number {
    if (isFinal || blocks.length === 0) return blocks.length;
    const last = blocks[blocks.length - 1];
    return last.type === "thinking" || last.type === "text"
      ? blocks.length - 1
      : blocks.length;
  }

  private renderBlock(
    block: LLMBlock,
    index: number,
    isStable: boolean,
    isFinal: boolean,
  ): void {
    if (block.type === "user") {
      process.stdout.write(`[user]\n${block.text.trim()}\n\n`);
    } else if (block.type === "thinking") {
      this.renderStreamingText(
        index,
        "[thinking]",
        block.thinking,
        isStable,
        isFinal,
      );
    } else if (block.type === "text") {
      this.renderStreamingText(
        index,
        "[assistant]",
        block.text,
        isStable,
        isFinal,
      );
    } else if (block.type === "tool_use") {
      if (!this.printedToolUses.has(block.id)) {
        this.printedToolUses.add(block.id);
        const callText = `${block.name}(${JSON.stringify(block.input)})`;
        process.stdout.write(`[tool] ${callText}\n`);
      }
    } else if (block.type === "tool_result") {
      if (!this.printedResults.has(block.tool_use_id)) {
        this.printedResults.add(block.tool_use_id);
        for (const line of block.content.split("\n")) {
          if (line) process.stdout.write(`       ${line}\n`);
        }
        if (isStable || isFinal) process.stdout.write("\n");
      }
    }
  }

  private renderStreamingText(
    index: number,
    label: string,
    text: string,
    isStable: boolean,
    isFinal: boolean,
  ): void {
    const prevLen = this.streamedChars.get(index) || 0;
    if (text.length > prevLen) {
      if (prevLen === 0) process.stdout.write(`${label}\n`);
      const content = prevLen === 0 ? text.trimStart() : text.slice(prevLen);
      process.stdout.write(content);
      this.streamedChars.set(index, text.length);
    }

    if ((isStable || isFinal) && !this.finalizedBlocks.has(index)) {
      process.stdout.write(text.endsWith("\n") ? "\n" : "\n\n");
      this.finalizedBlocks.add(index);
    }
  }

  private renderStatuses(): void {
    for (let i = this.lastStatusIdx; i < this.statuses.length; i++) {
      const s = this.statuses[i];
      if (s.role === "error") console.error(`[error] ${s.content}`);
      else if (s.toolDisplay) {
        const td = s.toolDisplay;
        console.log(
          `(${td.name}(${JSON.stringify(td.input)}) -> ${td.output ?? ""})`,
        );
      } else if (s.content) {
        console.log(s.content);
      }
    }
    this.lastStatusIdx = this.statuses.length;
  }
}
