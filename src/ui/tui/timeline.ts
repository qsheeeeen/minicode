import type { LLMContext } from "../../llm/context.js";
import type { RuntimeStatus } from "../../services/runtime-events.js";
import { toDisplayMessages } from "../display.js";
import { useTuiState } from "./state.js";

export class UITimeline {
  private context: LLMContext;
  private statuses: RuntimeStatus[] = [];
  private displays = new Map<number, string>();

  constructor(context: LLMContext) {
    this.context = context;
  }

  setContext(context: LLMContext, opts: { clearStatuses?: boolean } = {}): void {
    this.context = context;
    if (opts.clearStatuses ?? true) {
      this.statuses = [];
      this.displays.clear();
    }
    this.sync();
  }

  appendStatus(status: RuntimeStatus): void {
    this.statuses.push(status);
    this.sync();
  }

  /** Override the displayed text for the user message at `userIndex` (0-based). */
  setDisplay(userIndex: number, display: string): void {
    this.displays.set(userIndex, display);
  }

  sync(): void {
    useTuiState.setState({
      messages: toDisplayMessages(
        this.context.getBlocks(),
        this.statuses,
        this.displays,
      ),
    });
  }
}
