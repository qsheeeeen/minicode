import fs from 'fs/promises';
import path from 'path';
import type { ToolDef, ToolResult } from './index.js';

export const writeTool: ToolDef = {
  name: 'Write',
  description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does. Automatically creates parent directories.',
  requiresPermission: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const filePath = args.path as string;
      const content = args.content as string;
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { output: `Wrote ${filePath}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  }
};
