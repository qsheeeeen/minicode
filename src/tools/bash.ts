import { spawn } from 'child_process';

export const bashTool = {
  name: 'bash',
  description: 'Execute a bash command in the current working directory.',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' }
    },
    required: ['command']
  },
  execute: async (args: { command: string; timeout?: number }): Promise<string> => {
    return new Promise((resolve, reject) => {
      const proc = spawn(args.command, [], { shell: true });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d) => stdout += d.toString());
      proc.stderr?.on('data', (d) => stderr += d.toString());

      if (args.timeout) {
        setTimeout(() => proc.kill(), args.timeout * 1000);
      }

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout || stderr);
        else reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
      });
    });
  }
};
