import fs from 'fs/promises';
import path from 'path';

export const writeTool = {
  name: 'write',
  description: 'Write content to a file. Creates parent directories if needed.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  },
  execute: async (args: { path: string; content: string }) => {
    const dir = path.dirname(args.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(args.path, args.content, 'utf-8');
    return `Wrote ${args.path}`;
  }
};
