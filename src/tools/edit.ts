import React from 'react';
import { Box, Text } from 'ink';
import fs from 'fs/promises';
import { generateDiffSummary, renderDiffLines } from '../utils/diff.js';
import type { ToolDef, ToolResult } from './index.js';

export const editTool: ToolDef = {
  name: 'edit',
  description: 'Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' },
      oldText: { type: 'string' },
      newText: { type: 'string' }
    },
    required: ['path', 'oldText', 'newText']
  },
  format: (args: Record<string, unknown>) => {
    const path = args.path as string;
    const oldText = args.oldText as string;
    const preview = oldText.slice(0, 20).replace(/\n/g, '\\n');
    return React.createElement(Text, { color: 'yellow' }, `Edit(${path}, "${preview}${oldText.length > 20 ? '...' : ''}")`);
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
      return { output: `Edited ${path}`, display: renderDiffLines(diffLines) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg, display: React.createElement(Text, { color: 'red' }, msg) };
    }
  }
};
