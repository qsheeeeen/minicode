/**
 * LLMContext — pure data container for LLM conversation history.
 *
 * Holds the turn-level message array sent to/from the LLM, plus
 * display overrides that map turn indices to alternative display text.
 *
 * Mutated only through LLMContextManager — never directly.
 */
import type { MessageParam } from "../messages.js";

export class LLMContext {
  constructor(
    public turns: MessageParam[] = [],
    public displayOverrides: Map<number, string> = new Map(),
  ) {}
}
