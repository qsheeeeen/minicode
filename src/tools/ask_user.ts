import type { ToolDef, ToolResult, ToolExecutionContext } from "./registry.js";
import { ToolDeniedError } from "./registry.js";
import { register } from "./registry.js";

interface AskUserArgs {
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

export const askUserTool: ToolDef<AskUserArgs> = {
  name: "AskUser",
  description:
    "Ask the user a question with predefined options. Use this when you need the user to choose from a set of alternatives — for example, selecting a library, choosing an approach, or clarifying requirements. Set multiSelect to true when the user may select multiple options. The user can select options or reject all options and type their own response.",
  requiresPermission: false,
  readOnly: true,
  interactive: true,
  input_schema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description:
          "The question to ask the user. Should be clear and specific.",
      },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Short label for the option, should be unique",
            },
            description: {
              type: "string",
              description:
                "Explanation of what this option means or what will happen if chosen.",
            },
          },
          required: ["label", "description"],
        },
        minItems: 2,
        maxItems: 4,
        description:
          "2-4 mutually exclusive options for the user to choose from.",
      },
      multiSelect: {
        type: "boolean",
        description:
          "Set to true to allow multiple options to be selected. Default false means single selection.",
      },
    },
    required: ["question", "options"],
  },
  execute: async (
    args: AskUserArgs,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> => {
    const question = args.question;
    const options = args.options;
    if (!Array.isArray(options)) {
      return {
        output: `Error: AskUser tool requires 'options' to be an array, received: ${JSON.stringify(args.options)}`,
      };
    }
    const multiSelect = args.multiSelect ?? false;

    const answer = await context?.prompter?.prompt({
      message: question,
      options: options.map((o) => ({ ...o, value: o.label })),
      multiSelect,
    });

    if (!answer) {
      throw new ToolDeniedError(
        "AskUser",
        question,
        "User cancelled the question",
      );
    }
    return { output: `User selected: "${answer}"` };
  },
};
register(askUserTool);
