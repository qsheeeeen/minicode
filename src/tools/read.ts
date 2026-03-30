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
  format: (args: Record<string, unknown>) => {
    const path = args.path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    let info = `Read(${path}`;
    if (offset || limit) {
      const parts: string[] = [];
      if (offset) parts.push(`offset: ${offset}`);
      if (limit) parts.push(`limit: ${limit}`);
      info += `, ${parts.join(', ')}`;
    }
    return info + ')';
  },
  formatResult: (result: string) => {
    const lines = result.split('\n').length;
    const chars = result.length;
    return `Read ${lines} lines, ${chars} chars`;
  },
  execute: async (args: Record<string, unknown>) => {
    const path = args.path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    const content = await fs.readFile(path, 'utf-8');
    const lines = content.split('\n');
    const start = (offset || 1) - 1;
    const end = limit ? start + limit : lines.length;
    return lines.slice(start, end).join('\n');
  }
};
