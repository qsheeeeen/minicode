import type { LLMContext } from "../../llm/context.js";
import type { RuntimeStatus } from "../../services/runtime-events.js";
import { toDisplayMessages } from "../display.js";
import { useTuiState } from "./state.js";

export class UITimeline {
  private context: LLMContext;
  private statuses: RuntimeStatus[] = [];

  constructor(context: LLMContext) {
    this.context = context;
  }

  setContext(context: LLMContext, opts: { clearStatuses?: boolean } = {}): void {
    this.context = context;
    if (opts.clearStatuses ?? true) this.statuses = [];
    this.sync();
  }

  appendStatus(status: RuntimeStatus): void {
    this.statuses.push(status);
    this.sync();
  }

  sync(): void {
    useTuiState.setState({
      messages: toDisplayMessages(this.context.getBlocks(), this.statuses),
    });
  }
}
