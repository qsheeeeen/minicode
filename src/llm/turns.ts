import type { LLMThinkingBlock, LLMToolUseBlock } from "./client.js";

export interface LLMToolCallBlock extends Omit<LLMToolUseBlock, "type"> {
  type: "tool_call";
  result?: string;
}

export type LLMProcessBlock = LLMThinkingBlock | LLMToolCallBlock;

export interface LLMTurn {
  userText: string;
  process: LLMProcessBlock[];
  assistantText?: string;
}
