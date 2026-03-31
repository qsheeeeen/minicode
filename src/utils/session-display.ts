import React from 'react';
import { SessionManager, SessionData } from './session.js';
import { DisplayAdapter } from './display.js';
import { ToolRegistry } from '../tools/registry.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking';

export interface DisplayMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
  element?: React.ReactElement;
}

export interface SessionDisplay {
  loadForTUI(name: string): Promise<DisplayMessage[]>;
  loadForConsole(name: string, display: DisplayAdapter): Promise<void>;
}

export class SessionDisplayImpl implements SessionDisplay {
  constructor(private sessionManager: SessionManager, private toolRegistry: ToolRegistry) {}

  async loadForTUI(name: string): Promise<DisplayMessage[]> {
    const data = await this.sessionManager.get(name);
    if (!data) return [];

    return this.convertToDisplayMessages(data);
  }

  async loadForConsole(name: string, display: DisplayAdapter): Promise<void> {
    const messages = await this.loadForTUI(name);
    for (const msg of messages) {
      this.displayMessage(msg, display);
    }
    console.log();
  }

  private convertToDisplayMessages(data: SessionData): DisplayMessage[] {
    const messages: DisplayMessage[] = [];
    // Map tool_use_id -> tool name for result formatting
    const toolUseMap = new Map<string, string>();

    for (const msg of data.messages) {
      if (msg.role === 'user') {
        const content = msg.content;
        if (Array.isArray(content)) {
          // Tool results - display as tool_result messages
          for (const block of content as Array<any>) {
            if (block.type === 'tool_result') {
              const toolName = toolUseMap.get(block.tool_use_id);
              const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              messages.push({ role: 'tool_result', content: raw, timestamp: new Date(data.updatedAt) });
            }
          }
          continue;
        }
        messages.push({ role: 'user', content, timestamp: new Date(data.updatedAt) });
      } else if (msg.role === 'assistant') {
        const content = msg.content;
        if (Array.isArray(content)) {
          // Has tool calls or mixed content
          for (const block of content) {
            if (block.type === 'text') {
              messages.push({ role: 'assistant', content: (block as any).text, timestamp: new Date(data.updatedAt) });
            } else if (block.type === 'tool_use') {
              toolUseMap.set((block as any).id, block.name);
              // Use tool's format method to match live display
              const tool = this.toolRegistry.get(block.name);
              const element = tool?.format ? tool.format((block as any).input) : undefined;
              messages.push({ role: 'tool', content: '', timestamp: new Date(data.updatedAt), element });
            }
          }
        } else {
          messages.push({ role: 'assistant', content: content as string, timestamp: new Date(data.updatedAt) });
        }
      }
    }

    return messages;
  }

  private displayMessage(msg: DisplayMessage, display: DisplayAdapter): void {
    switch (msg.role) {
      case 'user':
        display.raw(msg.content);
        break;
      case 'assistant':
        display.raw(msg.content);
        break;
      case 'tool':
        if (msg.element) display.toolCall(msg.element);
        break;
      case 'tool_result':
        display.toolResult(msg.content);
        break;
      case 'system':
        display.system(msg.content);
        break;
      case 'error':
        display.error(msg.content);
        break;
    }
  }
}
