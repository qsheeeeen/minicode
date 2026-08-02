import { ToolRegistry } from "./registry.js";
import { registerBuiltinTools } from "./builtin/index.js";

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
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}
