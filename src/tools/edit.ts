import fs from 'fs/promises';
import { generateDiffSummary } from '../utils/diff.js';
import type { ToolDef, ToolResult } from './index.js';

export const editTool: ToolDef = {
  name: 'Edit',
  description: 'Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.',
  requiresPermission: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      oldText: { type: 'string' },
      newText: { type: 'string' }
    },
    required: ['path', 'oldText', 'newText']
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      let content = await fs.readFile(path, 'utf-8');
      if (!content.includes(oldText)) {
        throw new Error('oldText not found in file');
      }
      content = content.replace(oldText, newText);
      await fs.writeFile(path, content, 'utf-8');
      const diffLines = generateDiffSummary(path, oldText, newText);
      const diffText = diffLines.map(l => {
        const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
        return `${String(l.lineNum).padStart(4)} ${prefix} ${l.content}`;
      }).join('\n');
      return { output: `Edited ${path}\n${diffText}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg };
    }
  }
};
