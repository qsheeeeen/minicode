import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { StatusBar } from './StatusBar.js';
import { TuiProvider } from './store.js';

describe('StatusBar Component', () => {
  it('renders token usage, model info, and permission mode', () => {
    const mockAgentRef = {
      current: {
        getContextLength: () => 100000,
        getModelProvider: () => 'openai',
        getModelName: () => 'gpt-4',
      }
    } as any;

    const { lastFrame } = render(
      <TuiProvider initialState={{ 
        tokenCount: 25000,
        permissionMode: 'yolo',
        currentSession: 'test-session',
        status: 'working'
      }}>
        <StatusBar agentRef={mockAgentRef} />
      </TuiProvider>
    );

    const output = lastFrame();
    // Model info
    expect(output).toContain('openai');
    expect(output).toContain('gpt-4');
    expect(output).toContain('test-session');
    expect(output).toContain('working');

    // Token info
    expect(output).toContain('25,000/100,000');
    expect(output).toContain('25%');

    // Permission mode
    expect(output).toContain('yolo');
  });
});
