import type { ToolDef, ToolExecutionContext } from './index.js';
import type { AgentRegistry } from '../services/agent-registry.js';
import type { AgentConfig } from '../agent.js';
import type { DisplayMessage } from '../utils/session-display.js';
import type { DisplayAdapter } from '../utils/display.js';
import { Agent } from '../agent.js';
import { CallbackDisplay } from '../utils/display.js';

export const agentTool: ToolDef = {
  name: 'agent',
  description: 'Delegate a sub-task to an independent agent. Creates a new agent session that runs in parallel. The sub-agent has access to all tools (except agent) and returns a concise summary.',
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
  format: (args: { task: string }) => {
    const taskPreview = args.task.length > 30 ? args.task.slice(0, 30) + '...' : args.task;
    return `Agent(${taskPreview})`;
  },

  execute: async (args: { task: string }, context?: ToolExecutionContext): Promise<string> => {
    const { task } = args;
    const registry = context?.registry;
    const config = context?.config;
    const parentId = context?.currentAgentId || '1';

    if (!registry) {
      return 'Error: AgentRegistry not available';
    }

    if (!config) {
      return 'Error: Agent config not available';
    }

    // Allocate sub-agent ID
    const subId = registry.allocateSubId();

    // Create CallbackDisplay for sub-agent
    // We need to create a display that pushes messages to the registry
    const subMessages: DisplayMessage[] = [];
    const subDisplay: DisplayAdapter = new CallbackDisplay({
      onMessage: (msg) => {
        subMessages.push(msg);
        registry.addMessage(subId, msg);
      },
      onUpdateLast: (updater) => {
        const last = subMessages[subMessages.length - 1];
        if (last) {
          subMessages[subMessages.length - 1] = updater(last);
        }
      },
      onStatusUpdate: (status) => {
        // Could be used for progress tracking
      },
      onTokenUpdate: (tokens) => {
        // Token updates handled at session level
      }
    });

    // Create sub-agent config
    const subConfig: AgentConfig = {
      ...config,
      display: subDisplay,
      excludeTools: ['agent'],  // Prevent recursion
      agentRegistry: registry,
      currentAgentId: subId,
    };

    // Create sub-agent
    const subAgent = new Agent(subConfig);

    // Register session
    registry.register({
      id: subId,
      type: 'sub',
      agent: subAgent,
      display: subDisplay,
      messages: subMessages,
      status: 'running',
      task,
      parentId,
    });

    // Notify parent agent that sub-agent has started
    const parentSession = registry.get(parentId);
    if (parentSession?.display) {
      const taskPreview = task.length > 40 ? task.slice(0, 40) + '...' : task;
      parentSession.display.system(`[Agent #${subId} started: ${taskPreview} - Press Ctrl+${subId} to view]`);
    }

    // Run task and wait for completion
    try {
      await subAgent.run(task);
      // Extract final assistant response (the actual answer, not tool calls)
      const finalResponse = extractFinalResponse(subMessages);
      const summary = generateSummary(subMessages);
      registry.updateStatus(subId, 'completed');
      registry.updateSummary(subId, summary);

      // Return the actual response from sub-agent
      return finalResponse || `Agent #${subId} completed: ${summary}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      registry.updateStatus(subId, 'error');
      registry.updateSummary(subId, `Error: ${errorMsg}`);

      return `Agent #${subId} failed: ${errorMsg}`;
    }
  }
};

function extractFinalResponse(messages: DisplayMessage[]): string | null {
  // Find the last assistant message with actual text content
  // (not tool_use blocks, but the final response)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return null;
}

function generateSummary(messages: DisplayMessage[]): string {
  // Generate a concise summary from the agent's messages
  let toolCallCount = 0;
  let filesRead = 0;
  let filesWritten = 0;
  let errors = 0;

  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolCallCount++;
      if (msg.content.includes('Read(')) filesRead++;
      if (msg.content.includes('Write(')) filesWritten++;
    }
    if (msg.role === 'error') {
      errors++;
    }
  }

  const parts: string[] = [];
  if (toolCallCount > 0) parts.push(`${toolCallCount} operations`);
  if (filesRead > 0) parts.push(`${filesRead} files read`);
  if (filesWritten > 0) parts.push(`${filesWritten} files written`);
  if (errors > 0) parts.push(`${errors} errors`);

  if (parts.length === 0) return 'Task completed';

  return parts.join(', ');
}
