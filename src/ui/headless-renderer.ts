import type { ContentBlock } from "../messages.js";
import type { StatusMessage } from "../messages.js";
import type { LLMContextManager } from "../llm-context-manager.js";

/**
 * HeadlessRenderer — incremental stdout renderer for non-TUI mode.
 *
 * Encapsulates all rendering state (printed turns, streamed chars, etc.)
 * and the render algorithm. Subscribed to LLMContextManager changes
 * via onChange() for real-time streaming output.
 */
export class HeadlessRenderer {
  private context: LLMContextManager;
  private statuses: StatusMessage[] = [];

  // Rendering state
  private printedTurns = 0;
  private printedBlocks = new Map<number, number>();
  private streamedChars = new Map<string, number>();
  private finalizedBlocks = new Set<string>();
  private printedToolUses = new Set<string>();
  private printedResults = new Set<string>();
  private lastStatusIdx = 0;

  private unsubscribe: (() => void) | null = null;

  constructor(context: LLMContextManager) {
    this.context = context;
  }

  /** Add a status message to be rendered. */
  addStatus(msg: StatusMessage): void {
    this.statuses.push(msg);
  }

  /** Subscribe to context changes for incremental rendering. */
  start(): void {
    this.unsubscribe = this.context.onChange(() => this.render(false));
  }

  /** Stop listening to context changes. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Perform a final render pass. */
  renderFinal(): void {
    this.render(true);
  }

  render(isFinal = false): void {
    const turns = this.context.getTurns();

    for (let ti = this.printedTurns; ti < turns.length; ti++) {
      const turn = turns[ti];
      const isLastTurn = ti === turns.length - 1;

      if (turn.role === "user") {
        if (typeof turn.content === "string") {
          process.stdout.write(`[user]\n${turn.content.trim()}\n\n`);
        }
        this.printedTurns = ti + 1;
        continue;
      }

      if (turn.role === "assistant" && Array.isArray(turn.content)) {
        const blocks = turn.content as ContentBlock[];
        const blocksPrinted = this.printedBlocks.get(ti) || 0;

        for (let bi = blocksPrinted; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const blockKey = `${ti}:${bi}`;
          const isLastBlock = isLastTurn && bi === blocks.length - 1;

          if (block.type === "thinking") {
            const prevLen = this.streamedChars.get(blockKey) || 0;
            if (block.thinking.length > prevLen) {
              if (prevLen === 0) process.stdout.write(`[thinking]\n`);
              const content =
                prevLen === 0
                  ? block.thinking.trimStart()
                  : block.thinking.slice(prevLen);
              process.stdout.write(content);
              this.streamedChars.set(blockKey, block.thinking.length);
            }
            if (
              (!isLastBlock || isFinal) &&
              !this.finalizedBlocks.has(blockKey)
            ) {
              process.stdout.write(
                block.thinking.endsWith("\n") ? "\n" : "\n\n",
              );
              this.finalizedBlocks.add(blockKey);
            }
          }

          if (block.type === "text") {
            const prevLen = this.streamedChars.get(blockKey) || 0;
            if (block.text.length > prevLen) {
              if (prevLen === 0) process.stdout.write(`[assistant]\n`);
              const content =
                prevLen === 0 ? block.text.trimStart() : block.text.slice(prevLen);
              process.stdout.write(content);
              this.streamedChars.set(blockKey, block.text.length);
            }
            if (
              (!isLastBlock || isFinal) &&
              !this.finalizedBlocks.has(blockKey)
            ) {
              process.stdout.write(
                block.text.endsWith("\n") ? "\n" : "\n\n",
              );
              this.finalizedBlocks.add(blockKey);
            }
          }

          if (
            block.type === "tool_use" &&
            !this.printedToolUses.has(block.id)
          ) {
            this.printedToolUses.add(block.id);
            const callText = `${block.name}(${JSON.stringify(block.input)})`;
            process.stdout.write(`[tool] ${callText}\n`);

            // Scan subsequent turns for matching tool_result
            for (let rti = ti + 1; rti < turns.length; rti++) {
              const rt = turns[rti];
              if (rt.role === "user" && Array.isArray(rt.content)) {
                for (const rb of rt.content) {
                  if (
                    rb.type === "tool_result" &&
                    rb.tool_use_id === block.id
                  ) {
                    const raw =
                      typeof rb.content === "string"
                        ? rb.content
                        : JSON.stringify(rb.content);
                    const lines = raw.split("\n");
                    for (const line of lines) {
                      if (line) process.stdout.write(`       ${line}\n`);
                    }
                    if (!isLastBlock || isFinal) process.stdout.write("\n");
                    this.printedResults.add(block.id);
                  }
                }
              }
            }
          }
        }

        // Track progress
        if (!isLastTurn) {
          this.printedBlocks.set(ti, blocks.length);
          this.printedTurns = ti + 1;
        } else if (isFinal) {
          this.printedBlocks.set(ti, blocks.length);
          this.printedTurns = ti + 1;
        } else {
          // While streaming, keep the last block "active"
          this.printedBlocks.set(
            ti,
            blocks.length > 0 ? blocks.length - 1 : 0,
          );
        }
      }
    }

    // Print tool results for any printed tool_use blocks
    for (const turn of turns) {
      if (turn.role === "user" && Array.isArray(turn.content)) {
        for (const block of turn.content) {
          if (
            block.type === "tool_result" &&
            this.printedToolUses.has(block.tool_use_id) &&
            !this.printedResults.has(block.tool_use_id)
          ) {
            this.printedResults.add(block.tool_use_id);
            const raw =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            const lines = raw.split("\n");
            for (const line of lines) {
              if (line) console.log(`       ${line}`);
            }
            process.stdout.write("\n");
          }
        }
      }
    }

    // Print any new status messages
    for (let i = this.lastStatusIdx; i < this.statuses.length; i++) {
      const s = this.statuses[i];
      if (s.role === "error") console.error(`[error] ${s.content}`);
      else if (s.toolDisplay) {
        const td = s.toolDisplay;
        console.log(
          `(${td.name}(${JSON.stringify(td.input)}) → ${td.output ?? ""})`,
        );
      } else if (s.content) {
        console.log(s.content);
      }
    }
    this.lastStatusIdx = this.statuses.length;
  }
}
