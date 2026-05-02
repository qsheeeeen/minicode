import type { ToolDef, ToolResult, ToolExecutionContext } from './index.js';
import type { AgentConfig } from '../agent.js';
import type { MessageParam, ContentBlock } from '../llm/anthropic.js';
import { Agent } from '../agent.js';
import { ConsoleDisplay } from '../utils/display.js';

export const agentTool: ToolDef = {
  name: 'Agent',
  description: 'Delegate a sub-task to an independent agent. Creates a new agent session that runs in parallel. The sub-agent has access to all tools (except agent) and returns a concise summary.',
  requires: ['agentRegistry'],
  input_schema: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string' as const,
        description: 'The specific task to delegate to the sub-agent'
      }
    },
    required: ['task']
  },
  execute: async (args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> => {
    const task = args.task as string;
    const registry = context?.registry;
    const config = context?.config;
    const parentId = context?.currentAgentId || '1';

    if (!registry) {
      return { output: 'Error: AgentRegistry not available' };
    }

    if (!config) {
      return { output: 'Error: Agent config not available' };
    }

    const subId = registry.allocateSubId();

    const subConfig: AgentConfig = {
      ...config,
      display: new ConsoleDisplay(),
      excludeTools: ['Agent'],
      agentRegistry: registry,
      currentAgentId: subId,
    };

    const subAgent = new Agent(subConfig);

    context?.signal?.addEventListener('abort', () => {
      subAgent.abort();
    });

    registry.register({
      id: subId,
      type: 'sub',
      agent: subAgent,
      status: 'running',
      task,
      parentId,
    });

    // Notify via parent agent's store
    const parentSession = registry.get(parentId);
    if (parentSession) {
      const taskPreview = task.length > 40 ? task.slice(0, 40) + '...' : task;
      parentSession.agent.getStore().addStatus({
        role: 'status',
        content: `[Agent #${subId} started: ${taskPreview}]`,
        timestamp: new Date(),
      });
    }

    try {
      await subAgent.run(task);
      const turns = subAgent.getStore().getTurns();
      const finalResponse = extractFinalResponse(turns);
      const summary = generateSummary(turns);
      registry.updateStatus(subId, 'completed');
      registry.updateSummary(subId, summary);
      registry.remove(subId);

      const output = finalResponse || `Agent #${subId} completed: ${summary}`;
      return { output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      registry.updateStatus(subId, 'error');
      registry.updateSummary(subId, `Error: ${errorMsg}`);
      registry.remove(subId);

      return { output: `Agent #${subId} failed: ${errorMsg}` };
    }
  }
};

function extractFinalResponse(turns: MessageParam[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === 'assistant' && Array.isArray(turn.content)) {
      for (const block of turn.content as ContentBlock[]) {
        if (block.type === 'text' && block.text.trim()) {
          return block.text.trim();
        }
      }
    }
  }
  return null;
}

function generateSummary(turns: MessageParam[]): string {
  let toolCallCount = 0;

  for (const turn of turns) {
    if (turn.role === 'assistant' && Array.isArray(turn.content)) {
      for (const block of turn.content as ContentBlock[]) {
        if (block.type === 'tool_use') toolCallCount++;
      }
    }
  }

  return toolCallCount > 0 ? `${toolCallCount} operations` : 'Task completed';
}
