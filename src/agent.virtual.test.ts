import { describe, it, expect } from "vitest";
import { Agent } from "./agent.js";
import {
  VirtualLLMClient,
  defaultTextResponse,
  toolUseResponse,
} from "./llm/virtual.js";
import type { ScriptedResponse } from "./llm/virtual.js";
import { createVirtualTool } from "./testing.js";
import { ConsolePrompter, CallbackPrompter } from "./utils/display.js";
import type { ToolDef } from "./tools/registry.js";

function createTestAgent(options?: {
  responses?: ScriptedResponse[];
  tools?: Map<string, ToolDef>;
  permissionMode?: "manual" | "yolo" | "auto";
}) {
  const responses = options?.responses ?? [defaultTextResponse("OK")];
  const client = new VirtualLLMClient(responses);
  const tools =
    options?.tools ??
    new Map<string, ToolDef>([
      [
        "VirtualTool",
        createVirtualTool("VirtualTool", (args) =>
          `result: ${JSON.stringify(args)}`,
        ),
      ],
    ]);
  const agent = new Agent({
    client,
    tools,
    permissionMode: options?.permissionMode ?? "yolo",
    skipEnvironmentRefresh: true,
  });

  return { agent };
}

describe("Agent virtual integration", () => {
  it("scenario 1: pure text — LLM returns text, run ends, store has correct messages", async () => {
    const { agent } = createTestAgent({
      responses: [defaultTextResponse("Hello, I am the agent.")],
    });

    const completed = await agent.run("Hi there");
    expect(completed).toBe(true);

    const turns = agent.getStore().getTurns();
    expect(turns).toHaveLength(2);

    // Turn 0: user message
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("Hi there");

    // Turn 1: assistant text
    expect(turns[1].role).toBe("assistant");
    const content = turns[1].content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Hello, I am the agent.");
  });

  it("scenario 2: tool call — LLM tool_use, virtual tool executes, tool_result, LLM text reply", async () => {
    const virtualTool = createVirtualTool("Echo", (args) => `echoed: ${args.input}`);
    const tools = new Map([["Echo", virtualTool]]);

    const { agent } = createTestAgent({
      responses: [
        toolUseResponse("call_1", "Echo", { input: "hello" }),
        defaultTextResponse("The tool said: echoed: hello"),
      ],
      tools,
    });

    const completed = await agent.run("Use the Echo tool");
    expect(completed).toBe(true);

    const turns = agent.getStore().getTurns();
    // Turn 0: user message
    // Turn 1: assistant [tool_use block]
    // Turn 2: user [tool_result block]
    // Turn 3: assistant [text]
    expect(turns).toHaveLength(4);

    // Turn 1: assistant tool_use
    const assistantContent = turns[1].content as Array<{
      type: string;
      name: string;
    }>;
    expect(assistantContent[0].type).toBe("tool_use");
    expect(assistantContent[0].name).toBe("Echo");

    // Turn 2: tool_result
    expect(turns[2].role).toBe("user");
    const toolResult = turns[2].content as Array<{
      type: string;
      content: string;
    }>;
    expect(toolResult[0].type).toBe("tool_result");
    expect(toolResult[0].content).toBe("echoed: hello");

    // Turn 3: assistant text reply
    const finalContent = turns[3].content as Array<{
      type: string;
      text: string;
    }>;
    expect(finalContent[0].type).toBe("text");
    expect(finalContent[0].text).toBe("The tool said: echoed: hello");
  });

  it("scenario 3: multi-tool chain — tool A, tool B, text reply, verify order", async () => {
    const callOrder: string[] = [];
    const toolA = createVirtualTool("ToolA", (args) => {
      callOrder.push("A");
      return `A-result: ${args.q}`;
    });
    const toolB = createVirtualTool("ToolB", (args) => {
      callOrder.push("B");
      return `B-result: ${args.q}`;
    });
    const tools = new Map<string, ToolDef>([
      ["ToolA", toolA],
      ["ToolB", toolB],
    ]);

    const { agent } = createTestAgent({
      responses: [
        // LLM requests both tools in one response
        {
          events: [
            {
              type: "tool_use",
              block: {
                type: "tool_use",
                id: "call_a",
                name: "ToolA",
                input: { q: "1" },
              },
            },
            {
              type: "tool_use",
              block: {
                type: "tool_use",
                id: "call_b",
                name: "ToolB",
                input: { q: "2" },
              },
            },
          ],
          response: {
            content: [
              {
                type: "tool_use",
                id: "call_a",
                name: "ToolA",
                input: { q: "1" },
              },
              {
                type: "tool_use",
                id: "call_b",
                name: "ToolB",
                input: { q: "2" },
              },
            ],
            stop_reason: "tool_use",
            usage: {
              input: { total: 100, cache_miss: 50, cache_hit: 50 },
              output: 10,
            },
          },
        },
        defaultTextResponse("Both tools done."),
      ],
      tools,
    });

    const completed = await agent.run("Run both tools");
    expect(completed).toBe(true);

    // Verify tool execution order
    expect(callOrder).toEqual(["A", "B"]);

    const turns = agent.getStore().getTurns();
    // Turn 0: user
    // Turn 1: assistant [tool_use A, tool_use B]
    // Turn 2: user [tool_result A, tool_result B]
    // Turn 3: assistant [text]
    expect(turns).toHaveLength(4);

    const toolResults = turns[2].content as Array<{
      type: string;
      content: string;
    }>;
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0].content).toBe("A-result: 1");
    expect(toolResults[1].content).toBe("B-result: 2");
  });

  it("scenario 4: permission rejection — requiresPermission tool in manual mode, user rejects", async () => {
    const dangerousTool = createVirtualTool(
      "Dangerous",
      () => "destroyed",
      { requiresPermission: true, readOnly: false },
    );
    const tools = new Map<string, ToolDef>([["Dangerous", dangerousTool]]);

    const prompter = new CallbackPrompter(async () => "no");

    const agent = new Agent({
      client: new VirtualLLMClient([
        toolUseResponse("call_1", "Dangerous", { action: "delete" }),
      ]),
      tools,
      permissionMode: "manual",
      skipEnvironmentRefresh: true,
    });

    agent.setPrompter(prompter);

    const completed = await agent.run("Do something dangerous");
    expect(completed).toBe(true);

    const turns = agent.getStore().getTurns();
    // Turn 0: user message
    // Turn 1: assistant [tool_use]
    // Turn 2: user [tool_result with rejection reason]
    expect(turns).toHaveLength(3);

    const toolResult = turns[2].content as Array<{
      type: string;
      content: string;
    }>;
    expect(toolResult[0].content).toContain("User rejected");

    // Status message should indicate denial
    const statuses = agent.getStore().getStatuses();
    expect(
      statuses.some(
        (s) => s.role === "error" && s.content.includes("denied by user"),
      ),
    ).toBe(true);
  });
});
