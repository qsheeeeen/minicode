import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { shellTool } from "./shell.js";
import { pythonTool } from "./python.js";
import { grepTool } from "./grep.js";
import { createAgentTool } from "./sub-agent.js";
import { loadSkillTool } from "./load-skill.js";
import { askUserTool } from "./ask-user.js";
import type { ToolRegistry } from "../registry.js";
import type { AgentTypeRegistry } from "../agent-types.js";
import { createDefaultAgentTypes } from "../agent-types.js";

/** Explicit registration of every built-in tool. No import side effects. */
export function registerBuiltinTools(
  registry: ToolRegistry,
  opts: { agentTypes?: AgentTypeRegistry } = {},
): void {
  const agentTypes = opts.agentTypes ?? createDefaultAgentTypes();
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(shellTool);
  registry.register(pythonTool);
  registry.register(grepTool);
  registry.register(createAgentTool(agentTypes));
  registry.register(loadSkillTool);
  registry.register(askUserTool);
}
