import React from 'react';
import { Agent } from '../agent.js';
import { RecordDisplay } from '../utils/display.js';
import type { ResolvedConfig } from '../config.js';
import type { AgentMessage } from '../messages.js';
import type { SessionManager } from '../utils/session.js';
import { elementToText } from '../utils/react.js';
import { PermissionService, type PermissionMode, type PermissionGate, type PermissionRequest } from '../services/permission.js';
import { AnthropicClient } from '../llm/anthropic.js';

export interface HeadlessOptions {
  config: ResolvedConfig;
  userPrompt: string;
  initialPrompt: string;
  sessionManager: SessionManager;
  permissionMode: PermissionMode;
}

/** Headless permission gate: manual mode denies all, auto mode uses LLM */
class HeadlessPermissionGate implements PermissionGate {
  async requestApproval(req: PermissionRequest): Promise<boolean> {
    console.log(`[Permission denied: ${req.displayText}] -- use --permission yolo or auto in headless mode`);
    return false;
  }
}

export async function runHeadless({ config, userPrompt, initialPrompt, sessionManager, permissionMode }: HeadlessOptions): Promise<void> {
  const display = new RecordDisplay();

  // Create PermissionService if not yolo (yolo = no service needed, all allowed)
  let permissionService: PermissionService | undefined;
  if (permissionMode !== 'yolo') {
    const client = config.model ? new AnthropicClient(config.model.apiKey, config.model.baseURL) : undefined;
    const gate = permissionMode === 'manual' ? new HeadlessPermissionGate() : undefined;
    permissionService = new PermissionService({
      initialMode: permissionMode,
      gate,
      client,
      model: config.model?.model,
    });
  }

  const agent = new Agent({
    apiKey: config.model!.apiKey,
    baseURL: config.model!.baseURL,
    model: config.model!.model,
    contextLength: config.model!.contextLength,
    compressionThresholdRatio: config.compressionThreshold,
    thinkingEnabled: config.thinking.enabled,
    thinkingTokens: config.thinking.tokens,
    display,
    userPrompt,
    permissionService,
  });

  let lastPrintedIndex = 0;
  const streamed = new Map<string, number>();       // assistant msgId → chars printed
  const finalized = new Set<string>();               // msgIds with newline written
  const toolCallLines = new Map<string, number>();   // tool_call msgId → lines printed

  agent.getStore().onChange(() => {
    const raw = agent.getStore().getAll();

    // 1. Print new messages that don't need streaming tracking
    for (let i = lastPrintedIndex; i < raw.length; i++) {
      const msg = raw[i];
      // Skip: assistant (streamed), thinking (deferred), tool_call (element-tracked)
      if (msg.role === 'user' || msg.role === 'status' || msg.role === 'error') {
        printMessage(msg);
      }
    }
    lastPrintedIndex = raw.length;

    // 2. Track tool_call element updates — element grows from callFormat to callFormat + result
    for (const msg of raw) {
      if (msg.role === 'tool_call' && msg.element) {
        const text = elementToText(msg.element);
        const lines = text.split('\n');
        const printedCount = toolCallLines.get(msg.id) || 0;
        // Add separator + prefix before first tool call output
        if (printedCount === 0 && lines.length > 0) {
          process.stdout.write('\n[tool] ');
        }
        for (let j = printedCount; j < lines.length; j++) {
          if (lines[j]) console.log(j === 0 ? lines[j] : `       ${lines[j]}`);
        }
        if (lines.length > printedCount) {
          toolCallLines.set(msg.id, lines.length);
        }
      }
    }

    // 3. Stream assistant text incrementally
    for (const msg of raw) {
      if (msg.role === 'assistant' && msg.content) {
        const printed = streamed.get(msg.id) || 0;
        if (msg.content.length > printed) {
          // Add prefix before first chunk of assistant text
          if (printed === 0) {
            process.stdout.write('\n[assistant] ');
          }
          process.stdout.write(msg.content.slice(printed));
          streamed.set(msg.id, msg.content.length);
        }
        if (!msg.isStreaming && !finalized.has(msg.id)) {
          process.stdout.write('\n');
          finalized.add(msg.id);
        }
      }

      // 4. Thinking: print when finalized, full content
      if (msg.role === 'thinking' && !msg.isStreaming && msg.content && !finalized.has(msg.id)) {
        console.log(`\n[thinking] ${msg.content}`);
        finalized.add(msg.id);
      }
    }
  });

  try {
    await agent.run(initialPrompt);
  } catch (e) {
    if (e instanceof Error && e.message === 'Aborted') {
      console.log('(Aborted)');
    } else {
      throw e;
    }
  }

  // Auto-save session
  const sessionName = `headless-${Date.now()}`;
  await sessionManager.save(sessionName, {
    model: config.model?.model || 'unknown',
    messages: agent.getMessages() as any,
    totalTokens: agent.getTokenCount(),
    createdAt: '',
    updatedAt: '',
  });
}

function printMessage(msg: AgentMessage): void {
  switch (msg.role) {
    case 'user':
      process.stdout.write(`[user] ${msg.content}\n\n`);
      break;

    case 'status':
      console.log(`[status] ${msg.content}`);
      break;

    case 'error':
      console.error(`[error] ${msg.content}`);
      break;
  }
}
