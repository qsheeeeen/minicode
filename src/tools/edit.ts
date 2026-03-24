import fs from 'fs/promises';

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
  format: (args: { path: string; oldText: string; newText: string }) => {
    const preview = args.oldText.slice(0, 30).replace(/\n/g, '\\n');
    return `✂️  ${args.path} "${preview}${args.oldText.length > 30 ? '...' : ''}"`;
  },
  execute: async (args: { path: string; oldText: string; newText: string }) => {
    let content = await fs.readFile(args.path, 'utf-8');
    if (!content.includes(args.oldText)) {
      throw new Error('oldText not found in file');
    }
    content = content.replace(args.oldText, args.newText);
    await fs.writeFile(args.path, content, 'utf-8');
    return `Edited ${args.path}`;
  }
};
