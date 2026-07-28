// Typed capability keys for services tools consume. Define one here + register
// in create-app; ToolExecutionContext/ToolExecutor stay untouched.

import { capability } from "./registry.js";
import type { ShellService } from "../services/shell-service.js";
import type { AgentRegistry } from "../services/agent-registry.js";
import type { ChangeJournal } from "../services/change-journal.js";
import type { SubAgentSpawner } from "./registry.js";

export const ShellCapability = capability<ShellService>("shell");
export const RegistryCapability = capability<AgentRegistry>("agentRegistry");
export const ChangeJournalCapability =
  capability<ChangeJournal>("changeJournal");
export const SubAgentSpawnerCapability =
  capability<SubAgentSpawner>("subAgentSpawner");
