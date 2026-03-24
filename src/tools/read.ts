import fs from 'fs/promises';

export const readTool = {
  name: 'read',
  description: 'Read the contents of a file. Supports text files. Defaults to first 2000 lines. Use offset/limit for large files.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' }
    },
    required: ['path']
  },
  format: (args: { path: string; offset?: number; limit?: number }) => {
    let info = `📖 ${args.path}`;
    if (args.offset || args.limit) {
      const parts = [];
      if (args.offset) parts.push(`line ${args.offset}`);
      if (args.limit) parts.push(`${args.limit} lines`);
      info += ` (${parts.join(', ')})`;
    }
    return info;
  },
  execute: async (args: { path: string; offset?: number; limit?: number }) => {
    const content = await fs.readFile(args.path, 'utf-8');
    const lines = content.split('\n');
    const start = (args.offset || 1) - 1;
    const end = args.limit ? start + args.limit : lines.length;
    return lines.slice(start, end).join('\n');
  }
};
