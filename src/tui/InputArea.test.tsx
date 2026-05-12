import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { InputArea } from './InputArea.js';
import { TuiProvider } from './store.js';

describe('InputArea Component', () => {
  it('renders nothing when there is a pending prompt (isModal = true)', () => {
    const mockAgentRef = { current: {} } as any;
    
    const { lastFrame } = render(
      <TuiProvider initialState={{ 
        pendingPrompt: { message: 'hi', type: 'text', options: [], resolve: vi.fn() },
        input: { mode: 'chat', value: '', props: {}, key: 0 }
      }}>
        <InputArea agentRef={mockAgentRef} handleSubmit={vi.fn()} />
      </TuiProvider>
    );

    expect(lastFrame()).toBe('');
  });

  it('renders chat input by default', () => {
    const mockAgentRef = { current: {} } as any;
    
    const { lastFrame } = render(
      <TuiProvider initialState={{ 
        pendingPrompt: null,
        input: { mode: 'chat', value: '', props: {}, key: 0 }
      }}>
        <InputArea agentRef={mockAgentRef} handleSubmit={vi.fn()} />
      </TuiProvider>
    );

    const output = lastFrame();
    expect(output).toContain('Type a message or /command...');
    expect(output).toContain('>');
  });
});
