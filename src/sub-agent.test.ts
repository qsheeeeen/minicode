import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSubAgent } from "./sub-agent.js";
import { runAgent } from "./agent.js";
import { createAgentRuntime } from "./app/create-agent-runtime.js";
import { AgentRegistry } from "./services/agent-registry.js";
import { PermissionService } from "./services/permission.js";
import { Model } from "./llm/model.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  unwrapSuccess,
  unwrapError,
} from "./testing/index.js";
import { SessionPersistence } from "./services/session-persistence.js";
import {
  createCapabilities,
  type ToolExecutionContext,
} from "./tools/registry.js";
import {
  RegistryCapability,
  ChangeJournalCapability,
} from "./tools/capabilities.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import { createDefaultAgentTypes } from "./tools/agent-types.js";

vi.mock("./utils/tool-format.js", () => ({
  callContent: vi.fn((name: string) => `${name}()`),
}));

// Wrap runAgent so the failure path can be forced deterministically.
vi.mock("./agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent.js")>();
  return { ...actual, runAgent: vi.fn(actual.runAgent) };
});

function makeParent(
  registry: AgentRegistry,
  responses: Parameters<typeof VirtualLLMClient>[0],
): { parent: ToolExecutionContext; client: VirtualLLMClient } {
  const client = new VirtualLLMClient(responses);
  const model = new Model("test-model", "test-provider", 200000);
  const parent: ToolExecutionContext = {
    config: { client, model, userPrompt: "" },
    currentAgentId: "1",
    signal: new AbortController().signal,
    capabilities: createCapabilities([[RegistryCapability, registry]]),
  };
  return { parent, client };
}

describe("sub-agent", () => {
  beforeEach(() => {
    vi.spyOn(SessionPersistence, "getSessionDir").mockReturnValue(
      "/tmp/minicode-sub-agent-test",
    );
  });

  function defaultSpawnOptions() {
    return {
      toolRegistry: createDefaultToolRegistry(),
      agentTypes: createDefaultAgentTypes(),
      createRuntime: (opts: Parameters<typeof createAgentRuntime>[0]) =>
        createAgentRuntime(opts),
    };
  }

  describe("createAgentRuntime", () => {
    it("wires a complete AgentDeps graph", () => {
      const runtime = createAgentRuntime({
        client: new VirtualLLMClient([defaultTextResponse("ok")]),
        model: new Model("m", "p", 200000),
        userPrompt: "",
        tools: new Map(),
        permissionService: new PermissionService("yolo"),
        currentAgentId: "2",
        capabilities: ({ sessionManager }) =>
          createCapabilities([
            [ChangeJournalCapability, sessionManager.getChangeJournal()],
          ]),
      });
      expect(runtime.deps.sessionManager).toBeDefined();
      expect(runtime.deps.contextManager).toBe(runtime.contextManager);
      expect(runtime.deps.toolExecutor).toBeDefined();
      expect(runtime.deps.promptManager).toBeDefined();
    });
  });

  describe("runSubAgent", () => {
    it("spawns a researcher, returns its reply, and cleans up the registry", async () => {
      const registry = new AgentRegistry();
      const { parent } = makeParent(registry, [
        defaultTextResponse("found 3 files"),
      ]);

      const result = await runSubAgent({
        task: "explore src",
        agentType: "researcher",
        parent,
        permissionService: new PermissionService("yolo"),
        ...defaultSpawnOptions(),
      });

      expect(result.outcome).toBe("success");
      expect(unwrapSuccess(result)).toContain("found 3 files");
      expect(registry.getAll()).toHaveLength(0); // registered then removed
    });

    it("defaults to researcher when agentType is omitted", async () => {
      const registry = new AgentRegistry();
      const { parent } = makeParent(registry, [defaultTextResponse("ok")]);
      const result = await runSubAgent({
        task: "x",
        parent,
        permissionService: new PermissionService("yolo"),
        ...defaultSpawnOptions(),
      });
      expect(result.outcome).toBe("success");
    });

    it("returns error for an unknown agent type", async () => {
      const registry = new AgentRegistry();
      const { parent } = makeParent(registry, []);
      const result = await runSubAgent({
        task: "x",
        agentType: "no-such-type",
        parent,
        permissionService: new PermissionService("yolo"),
        ...defaultSpawnOptions(),
      });
      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("Unknown agent type");
    });

    it("returns error when registry is missing", async () => {
      const client = new VirtualLLMClient([defaultTextResponse("ok")]);
      const parent: ToolExecutionContext = {
        config: {
          client,
          model: new Model("m", "p", 200000),
          userPrompt: "",
        },
        currentAgentId: "1",
        signal: new AbortController().signal,
        capabilities: createCapabilities([]),
      };
      const result = await runSubAgent({
        task: "x",
        parent,
        permissionService: new PermissionService("yolo"),
        ...defaultSpawnOptions(),
      });
      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("AgentRegistry");
    });

    it("returns error (not success) when the child run fails", async () => {
      const registry = new AgentRegistry();
      const { parent } = makeParent(registry, []);
      vi.mocked(runAgent).mockRejectedValueOnce(new Error("boom"));

      const result = await runSubAgent({
        task: "x",
        parent,
        permissionService: new PermissionService("yolo"),
        ...defaultSpawnOptions(),
      });

      expect(result.outcome).toBe("error");
      expect(unwrapError(result)).toContain("Agent #");
      expect(unwrapError(result)).toContain("boom");
      expect(registry.getAll()).toHaveLength(0); // cleaned up
    });
  });
});
