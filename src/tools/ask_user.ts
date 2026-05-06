import type { ToolDef, ToolResult, ToolExecutionContext } from './index.js';
import { ToolDeniedError } from './index.js';

export const askUserTool: ToolDef = {
  name: 'AskUser',
  description:
    'Ask the user a question with predefined options. Use this when you need the user to choose from a set of alternatives — for example, selecting a library, choosing an approach, or clarifying requirements. The user can select an option or reject all options and type their own response.',
  requiresPermission: false,
  input_schema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Should be clear and specific.',
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Short label for the option, should be unique',
            },
            description: {
              type: 'string',
              description: 'Explanation of what this option means or what will happen if chosen.',
            },
          },
          required: ['label', 'description'],
        },
        minItems: 2,
        maxItems: 4,
        description: '2-4 mutually exclusive options for the user to choose from.',
      },
    },
    required: ['question', 'options'],
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const question = args.question as string;
    const options = args.options as Array<{ label: string; description: string }>;

    const answer = await context?.display?.askUser?.({ question, options });

    if (!answer) {
      throw new ToolDeniedError('AskUser', question);
    }
    return { output: `User selected: "${answer}"` };
  },
};
