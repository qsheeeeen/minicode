import { SessionManager, SessionData } from './session.js';
import { DisplayAdapter } from './display.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking';

export interface DisplayMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
}

export interface SessionDisplay {
  loadForTUI(name: string): Promise<DisplayMessage[]>;
  loadForConsole(name: string, display: DisplayAdapter): Promise<void>;
}

export class SessionDisplayImpl implements SessionDisplay {
  constructor(private sessionManager: SessionManager) {}

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

    for (const msg of data.messages) {
      if (msg.role === 'user') {
        const content = msg.content;
        if (Array.isArray(content)) {
          // Tool results - display as tool_result messages
          for (const block of content as Array<any>) {
            if (block.type === 'tool_result') {
              messages.push({ role: 'tool_result', content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content), timestamp: new Date(data.updatedAt) });
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
              // Tool call - display as tool message
              messages.push({ role: 'tool', content: `${block.name}(${JSON.stringify((block as any).input)})`, timestamp: new Date(data.updatedAt) });
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
        display.toolCall(msg.content);
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
