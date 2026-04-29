import React from 'react';

export type MessageRole = 'user' | 'assistant' | 'status' | 'tool' | 'tool_result' | 'error' | 'thinking';

export interface DisplayMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  isStreaming?: boolean;
  element?: React.ReactElement;
  slotId?: string;
}
