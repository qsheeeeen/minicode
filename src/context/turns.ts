import type { ProcessBlock } from "./blocks.js";

export interface ContextTurn {
  userText: string;
  process: ProcessBlock[];
  assistantText?: string;
}
