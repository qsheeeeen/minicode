import React from 'react';
import { Text } from 'ink';
import type { ToolDef, ToolResult, ToolExecutionContext } from './index.js';
import type { AgentConfig } from '../agent.js';
import type { AgentMessage } from '../messages.js';
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
  formatCall(args: Record<string, unknown>) {
    const task = args.task as string;
    const taskPreview = task.length > 30 ? task.slice(0, 30) + '...' : task;
    return React.createElement(Text, { color: 'yellow' }, `${this.name}(${taskPreview})`);
  },

  formatResult(output: string, _input: Record<string, unknown>) {
    return React.createElement(Text, { dimColor: true }, output);
  },
  execute: async (args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> => {
    const task = args.task as string;
    const registry = context?.registry;
    const config = context?.config;
    const parentId = context?.currentAgentId || '1';

    if (!registry) {
      return { output: 'Error: AgentRegistry not available', display: React.createElement(Text, { color: 'red' }, 'Error: AgentRegistry not available') };
    }

    if (!config) {
      return { output: 'Error: Agent config not available', display: React.createElement(Text, { color: 'red' }, 'Error: Agent config not available') };
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
      parentSession.agent.getStore().add({
        role: 'status',
        content: `[Agent #${subId} started: ${taskPreview}]`,
        timestamp: new Date(),
        inContext: false,
      });
    }

    try {
      await subAgent.run(task);
      const storeMessages = subAgent.getStore().getAll();
      const finalResponse = extractFinalResponse(storeMessages);
      const summary = generateSummary(storeMessages);
      registry.updateStatus(subId, 'completed');
      registry.updateSummary(subId, summary);
      registry.remove(subId);

      const output = finalResponse || `Agent #${subId} completed: ${summary}`;
      return {
        output,
        display: React.createElement(Text, { dimColor: true }, output)
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      registry.updateStatus(subId, 'error');
      registry.updateSummary(subId, `Error: ${errorMsg}`);
      registry.remove(subId);

      return { output: `Agent #${subId} failed: ${errorMsg}`, display: React.createElement(Text, { color: 'red' }, `Agent #${subId} failed: ${errorMsg}`) };
    }
  }
};

function extractFinalResponse(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return null;
}

function generateSummary(messages: AgentMessage[]): string {
  let toolCallCount = 0;
  let errors = 0;

  for (const msg of messages) {
    if (msg.role === 'tool_use') toolCallCount++;
    if (msg.role === 'error') errors++;
  }

  const parts: string[] = [];
  if (toolCallCount > 0) parts.push(`${toolCallCount} operations`);
  if (errors > 0) parts.push(`${errors} errors`);

  return parts.length === 0 ? 'Task completed' : parts.join(', ');
}
