import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { shellTool } from "./shell.js";
import { grepTool } from "./grep.js";
import { agentTool } from "./sub-agent.js";
import { loadSkillTool } from "./load-skill.js";
import { askUserTool } from "./ask-user.js";
import type { ToolRegistry } from "../registry.js";

/** Explicit registration of every built-in tool. No import side effects. */
export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(shellTool);
  registry.register(grepTool);
  registry.register(agentTool);
  registry.register(loadSkillTool);
  registry.register(askUserTool);
}
