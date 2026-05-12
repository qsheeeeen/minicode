import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { MessageList } from './MessageList.js';
import { TuiProvider } from './store.js';

describe('MessageList Component', () => {
  it('shows welcome text when there are no messages', () => {
    const { lastFrame } = render(
      <TuiProvider initialState={{ messages: [] }}>
        <MessageList />
      </TuiProvider>
    );

    const output = lastFrame();
    expect(output).toContain('Type a message to start');
  });

  it('renders a list of messages', () => {
    const { lastFrame } = render(
      <TuiProvider initialState={{ 
        messages: [
          { role: 'user', content: 'Hello', timestamp: new Date() },
          { role: 'text', content: 'Hi there!', timestamp: new Date() }
        ] 
      }}>
        <MessageList />
      </TuiProvider>
    );

    const output = lastFrame();
    expect(output).toContain('Hello');
    expect(output).toContain('Hi there!');
  });
});
