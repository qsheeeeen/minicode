import React from 'react';
import { SessionManager, SessionData } from './session.js';
import { ToolRegistry } from '../tools/registry.js';

export type MessageRole = 'user' | 'assistant' | 'status' | 'tool' | 'tool_result' | 'error' | 'thinking';

export interface DisplayMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
  element?: React.ReactElement;
  slotId?: string;
}

export class SessionDisplayImpl {
  constructor(private sessionManager: SessionManager, private toolRegistry: ToolRegistry) {}

  async loadForTUI(name: string): Promise<DisplayMessage[]> {
    const data = await this.sessionManager.get(name);
    if (!data) return [];
    return this.convertToDisplayMessages(data);
  }

  private convertToDisplayMessages(data: SessionData): DisplayMessage[] {
    const messages: DisplayMessage[] = [];
    const toolUseMap = new Map<string, string>();

    for (const msg of data.messages) {
      if (msg.role === 'user') {
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<any>) {
            if (block.type === 'tool_result') {
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
          for (const block of content) {
            if (block.type === 'text') {
              messages.push({ role: 'assistant', content: (block as any).text, timestamp: new Date(data.updatedAt) });
            } else if (block.type === 'tool_use') {
              toolUseMap.set((block as any).id, block.name);
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
}
