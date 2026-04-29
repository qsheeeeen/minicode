import React from 'react';
import { Text } from 'ink';
import { spawn } from 'child_process';
import type { ToolDef, ToolResult, ToolExecutionContext } from './index.js';

export const bashTool: ToolDef = {
  name: 'Bash',
  description: 'Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.',
  requiresPermission: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' }
    },
    required: ['command']
  },
  format(args: Record<string, unknown>) {
    return React.createElement(Text, { color: 'yellow' }, `${this.name}(${args.command as string})`);
  },
  execute: async (args: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const command = args.command as string;
      const timeout = args.timeout as number | undefined;
      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn(command, [], { shell: true });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (d) => {
          stdout += d.toString();
          context?.display?.update(React.createElement(Text, { dimColor: true }, stdout + (stderr ? '\n' + stderr : '')));
        });
        proc.stderr?.on('data', (d) => {
          stderr += d.toString();
          context?.display?.update(React.createElement(Text, { dimColor: true }, stdout + (stderr ? '\n' + stderr : '')));
        });

        if (timeout) {
          setTimeout(() => proc.kill(), timeout * 1000);
        }

        if (context?.signal?.aborted) {
          proc.kill();
          resolve('Aborted');
          return;
        }
        context?.signal?.addEventListener('abort', () => {
          proc.kill();
        });

        proc.on('close', (code) => {
          if (context?.signal?.aborted) {
            resolve('Aborted');
          } else if (code === 0) {
            resolve(stdout || stderr);
          } else {
            reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
          }
        });
      });
      const trimmed = output.trim();
      return {
        output: trimmed,
        display: React.createElement(Text, { dimColor: true }, trimmed)
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg, display: React.createElement(Text, { color: 'red' }, msg) };
    }
  }
};
