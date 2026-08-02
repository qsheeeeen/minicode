import { ToolRegistry } from "./registry.js";
import { registerBuiltinTools } from "./builtin/index.js";
import type { AgentTypeRegistry } from "./agent-types.js";

export { ToolRegistry, capability, createCapabilities } from "./registry.js";
export type {
  ToolDef,
  ToolRunResult,
  ToolExecutionContext,
  ToolRequirement,
  UserPrompter,
  Prompt,
  PromptOption,
  Capabilities,
  Capability,
  SubAgentSpawner,
  SubAgentSpawnParams,
} from "./registry.js";

/** Fresh registry preloaded with every built-in tool. */
export function createDefaultToolRegistry(
  opts: {
    agentTypes?: AgentTypeRegistry;
  } = {},
): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, opts);
  return registry;
}
