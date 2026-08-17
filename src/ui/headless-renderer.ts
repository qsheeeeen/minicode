import type { LLMContext } from "../core/context.js";
import type { LLMBlock } from "../core/blocks.js";
import { callContent } from "../utils/tool-format.js";
import type { SessionTimeline } from "./timeline.js";

/**
 * HeadlessRenderer — incremental stdout printer for non-TUI mode.
 *
 * It is a pure printer: all view bookkeeping (statuses, display overrides,
 * derived messages) lives on the shared SessionTimeline, which the TUI uses
 * too. This renderer only tracks what has already been printed.
 */
export class HeadlessRenderer {
  private timeline: SessionTimeline;
  private context: LLMContext;
  private userCount = 0;
  private printedBlocks = 0;
  private streamedChars = new Map<number, number>();
  private finalizedBlocks = new Set<number>();
  private printedToolUses = new Set<string>();
  private printedResults = new Set<string>();
  private lastStatusIdx = 0;
  private unsubMessages: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(timeline: SessionTimeline) {
    this.timeline = timeline;
    this.context = timeline.getContext();
    this.unsubMessages = timeline.onMessages(() => this.render(false));
  }

  start(): void {
    this.unsubscribe = this.context.onChange(() => this.timeline.sync());
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubMessages?.();
    this.unsubMessages = null;
  }

  renderFinal(): void {
    this.timeline.sync();
    this.render(true);
  }

  render(isFinal = false): void {
    const blocks = this.context.getBlocksReadonly();
    const stableCount = this.getStableBlockCount(blocks, isFinal);

    for (let i = this.printedBlocks; i < blocks.length; i++) {
      this.renderBlock(blocks[i], i, i < stableCount, isFinal);
    }
    this.printedBlocks = stableCount;

    this.renderStatuses();
  }

  private getStableBlockCount(
    blocks: readonly LLMBlock[],
    isFinal: boolean,
  ): number {
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
      const display = this.timeline.getDisplay(this.userCount);
      this.userCount++;
      process.stdout.write(`[user]\n${(display ?? block.text).trim()}\n\n`);
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
        const callText = callContent(block.name, block.input);
        process.stdout.write(`[tool] ${callText}\n`);
      }
    } else if (block.type === "tool_result") {
      if (!this.printedResults.has(block.tool_use_id)) {
        this.printedResults.add(block.tool_use_id);
        for (const line of block.content.split("\n")) {
          if (line) process.stdout.write(`${line}\n`);
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
    const statuses = this.timeline.getStatuses();
    for (let i = this.lastStatusIdx; i < statuses.length; i++) {
      const s = statuses[i];
      if (s.role === "error") console.error(`[error] ${s.content}`);
      else if (s.toolDisplay) {
        const td = s.toolDisplay;
        console.log(
          `(${callContent(td.name, td.input)} -> ${td.output ?? ""})`,
        );
      } else if (s.content) {
        console.log(s.content);
      }
    }
    this.lastStatusIdx = statuses.length;
  }
}
