import { spawn } from 'child_process';

export const bashTool = {
  name: 'bash',
  description: 'Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' }
    },
    required: ['command']
  },
  format: (args: Record<string, unknown>) => {
    return `Bash(${args.command as string})`;
  },
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const command = args.command as string;
    const timeout = args.timeout as number | undefined;
    return new Promise((resolve, reject) => {
      const proc = spawn(command, [], { shell: true });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (d) => stdout += d.toString());
      proc.stderr?.on('data', (d) => stderr += d.toString());

      if (timeout) {
        setTimeout(() => proc.kill(), timeout * 1000);
      }

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout || stderr);
        else reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
      });
    });
  }
};
