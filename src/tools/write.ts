import fs from 'fs/promises';
import path from 'path';

export const writeTool = {
  name: 'write',
  description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does. Automatically creates parent directories.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  },
  format: (args: { path: string; content: string }) => {
    const lines = args.content.split('\n').length;
    return `Write(${args.path}, ${lines} lines)`;
  },
  execute: async (args: { path: string; content: string }) => {
    const dir = path.dirname(args.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(args.path, args.content, 'utf-8');
    return `Wrote ${args.path}`;
  }
};
