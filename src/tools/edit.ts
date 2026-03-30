import fs from 'fs/promises';
import { encodeEditResult, tryParseEditResult, renderDiffText } from '../utils/diff.js';

export const editTool = {
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
    return `Edit(${path}, "${preview}${oldText.length > 20 ? '...' : ''}")`;
  },
  formatResult: (result: string) => {
    const parsed = tryParseEditResult(result);
    if (parsed) {
      return renderDiffText(parsed.path, parsed.oldText, parsed.newText);
    }
    return result;
  },
  execute: async (args: Record<string, unknown>) => {
    const path = args.path as string;
    const oldText = args.oldText as string;
    const newText = args.newText as string;
    let content = await fs.readFile(path, 'utf-8');
    if (!content.includes(oldText)) {
      throw new Error('oldText not found in file');
    }
    content = content.replace(oldText, newText);
    await fs.writeFile(path, content, 'utf-8');
    return encodeEditResult(path, oldText, newText);
  }
};
