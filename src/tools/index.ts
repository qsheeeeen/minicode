export { register, getAll, getSubAgentTools } from "./registry.js";
export type {
  ToolDef,
  ToolRunResult,
  ToolExecutionContext,
  ToolRequirement,
  UserPrompter,
  Prompt,
  PromptOption,
} from "./registry.js";

// Side-effect imports: each tool file registers itself via register()
// imported from registry.ts at module scope.
import "./builtin/index.js";
