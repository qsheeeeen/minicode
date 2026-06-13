import type { StatusMessage } from "../messages.js";
import type { ContextStore } from "../context/index.js";

/**
 * HeadlessRenderer — incremental stdout renderer for non-TUI mode.
 *
 * Encapsulates all rendering state (printed turns, streamed chars, etc.)
 * and the render algorithm. Subscribed to ContextStore changes
 * via onChange() for real-time streaming output.
 */
export class HeadlessRenderer {
  private context: ContextStore;
  private statuses: StatusMessage[] = [];

  // Rendering state
  private printedTurns = 0;
  private printedProcessBlocks = new Map<number, number>();
  private printedAssistantChars = new Map<number, number>();
  private streamedChars = new Map<string, number>();
  private finalizedBlocks = new Set<string>();
  private printedToolUses = new Set<string>();
  private printedResults = new Set<string>();
  private lastStatusIdx = 0;

  private unsubscribe: (() => void) | null = null;

  constructor(context: ContextStore) {
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

      if (!this.printedProcessBlocks.has(ti)) {
        process.stdout.write(`[user]\n${turn.userText.trim()}\n\n`);
      }

      const blocksPrinted = this.printedProcessBlocks.get(ti) || 0;
      for (let bi = blocksPrinted; bi < turn.process.length; bi++) {
        const block = turn.process[bi];
        const blockKey = `${ti}:${bi}`;
        const isLastBlock =
          isLastTurn && bi === turn.process.length - 1 && !turn.assistantText;

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
            process.stdout.write(block.thinking.endsWith("\n") ? "\n" : "\n\n");
            this.finalizedBlocks.add(blockKey);
          }
        }

        if (block.type === "tool_call" && !this.printedToolUses.has(block.id)) {
          this.printedToolUses.add(block.id);
          const callText = `${block.name}(${JSON.stringify(block.input)})`;
          process.stdout.write(`[tool] ${callText}\n`);
        }
        if (
          block.type === "tool_call" &&
          block.result !== undefined &&
          !this.printedResults.has(block.id)
        ) {
          this.printedResults.add(block.id);
          const lines = block.result.split("\n");
          for (const line of lines) {
            if (line) process.stdout.write(`       ${line}\n`);
          }
          if (!isLastBlock || isFinal) process.stdout.write("\n");
        }
      }

      if (turn.assistantText) {
        const prevLen = this.printedAssistantChars.get(ti) || 0;
        if (turn.assistantText.length > prevLen) {
          if (prevLen === 0) process.stdout.write(`[assistant]\n`);
          const content =
            prevLen === 0
              ? turn.assistantText.trimStart()
              : turn.assistantText.slice(prevLen);
          process.stdout.write(content);
          this.printedAssistantChars.set(ti, turn.assistantText.length);
        }
        const blockKey = `${ti}:assistant`;
        if ((isFinal || !isLastTurn) && !this.finalizedBlocks.has(blockKey)) {
          process.stdout.write(
            turn.assistantText.endsWith("\n") ? "\n" : "\n\n",
          );
          this.finalizedBlocks.add(blockKey);
        }
      }

      if (!isLastTurn || isFinal) {
        this.printedProcessBlocks.set(ti, turn.process.length);
        this.printedTurns = ti + 1;
      } else {
        const lastProcess = turn.process[turn.process.length - 1];
        const activeThinking = lastProcess?.type === "thinking";
        this.printedProcessBlocks.set(
          ti,
          activeThinking
            ? Math.max(0, turn.process.length - 1)
            : turn.process.length,
        );
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
