// Tool requirements — declared objects with their own environment probe.
// Adding a requirement means adding one entry here and referencing it from
// a tool; no enum to extend, no availability table to hand-maintain.

import type { ShellService } from "../services/shell-service.js";

export interface RequirementEnv {
  shell: ShellService;
}

export interface ToolRequirementDef {
  readonly name: string;
  /** Probe whether the runtime environment satisfies this requirement. */
  probe: (env: RequirementEnv) => Promise<boolean>;
}

/** Provided by the composition root (AgentRegistry capability). */
export const agentRegistryRequirement: ToolRequirementDef = {
  name: "agentRegistry",
  probe: async () => true,
};

/** Python tooling — probing avoids registering a tool that would just fail
 *  and waste agent turns on environments without python3. */
export const python3Requirement: ToolRequirementDef = {
  name: "python3",
  probe: async (env) => {
    try {
      const probe = await env.shell.runProcess("python3", ["--version"], {
        timeoutMs: 5000,
      });
      return probe.exitCode === 0;
    } catch {
      return false;
    }
  },
};
