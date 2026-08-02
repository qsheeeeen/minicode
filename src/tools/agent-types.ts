// Declarative agent-type registry. The SubAgent tool picks a type by name;
// sub-agent-runtime reads it to configure the child. Pure data, zero deps.

export type SubAgentToolSet = "readonly" | "all" | string[];

export interface SubAgentType {
  name: string;
  description: string;
  systemPrompt: string;
  /** "readonly" | "all" | explicit name list. */
  tools: SubAgentToolSet;
  tier?: "pro" | "flash";
}

const types = new Map<string, SubAgentType>();

export function registerAgentType(t: SubAgentType): void {
  types.set(t.name, t);
}

export function getAgentType(name: string): SubAgentType | undefined {
  return types.get(name);
}

export function listAgentTypes(): SubAgentType[] {
  return [...types.values()];
}

/** Default when the SubAgent tool omits `agentType`. Equivalent to legacy read-only. */
export const DEFAULT_AGENT_TYPE = "researcher";

// ── Built-in types ─────────────────────────────────────────────────────────

function registerBuiltinAgentTypes(): void {
  registerAgentType({
    name: "researcher",
    description:
      "Read-only investigation: code exploration, search, dependency analysis, debugging research.",
    systemPrompt: `You are a read-only research sub-agent. Investigate the task using only read-only tools (Read, Grep, Shell for ls/find/grep). Do NOT modify any files. Explore broadly, then return a concise, factual summary of your findings with file:line references.`,
    tools: "readonly",
  });

  registerAgentType({
    name: "reviewer",
    description:
      "Read-only code review: critique code or a change for bugs, security, architecture.",
    systemPrompt: `You are a code-review sub-agent. Review code using read-only tools only. Focus on correctness, security, and clarity. Do NOT modify files. Return specific findings ranked most-severe first, each with a file:line reference and a concrete failure scenario.`,
    tools: "readonly",
  });

  registerAgentType({
    name: "planner",
    description:
      "Read-only planning: produce a step-by-step implementation plan without executing it.",
    systemPrompt: `You are a software-architecture sub-agent. Investigate the codebase with read-only tools and produce a concrete, step-by-step implementation plan. Do NOT modify files or start implementing. Output only the plan, each step stating what to do and how to verify it.`,
    tools: "readonly",
  });

  registerAgentType({
    name: "worker",
    description:
      "Execute a well-scoped sub-task with full read/write tools (files, shell).",
    systemPrompt: `You are a worker sub-agent with read/write tools. Execute the assigned task directly — edit files, run commands. Keep changes minimal and focused on the task. Return a summary of what you did and how to verify it.`,
    tools: "all",
  });
}

registerBuiltinAgentTypes();

/** Reset to the built-in type set (test isolation). */
export function resetAgentTypes(): void {
  types.clear();
  registerBuiltinAgentTypes();
}
