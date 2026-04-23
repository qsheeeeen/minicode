import { describe, it, expect } from 'vitest';
import { agentTool } from './agent.js';

describe('agentTool', () => {
  describe('format', () => {
    it('formats short task', () => {
      const formatted = agentTool.format({ task: 'simple task' });
      expect(formatted.props.children).toContain('simple task');
    });

    it('truncates long task', () => {
      const longTask = 'a'.repeat(50);
      const formatted = agentTool.format({ task: longTask });
      expect(formatted.props.children).not.toContain(longTask);
      expect(formatted.props.children).toContain('...');
    });

    it('shows full task when exactly 30 chars', () => {
      const task = 'a'.repeat(30);
      const formatted = agentTool.format({ task });
      expect(formatted.props.children).toBe('Agent(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)');
    });

    it('truncates at 30 chars', () => {
      const task = 'a'.repeat(35);
      const formatted = agentTool.format({ task });
      expect(formatted.props.children).toContain('...');
    });
  });

  describe('execute', () => {
    it('returns error when registry not available', async () => {
      const result = await agentTool.execute({ task: 'test' }, {});
      expect(result.output).toContain('AgentRegistry not available');
    });

    it('returns error when config not available', async () => {
      const result = await agentTool.execute(
        { task: 'test' },
        { registry: { allocateSubId: () => '2' } as any }
      );
      expect(result.output).toContain('Agent config not available');
    });
  });
});
