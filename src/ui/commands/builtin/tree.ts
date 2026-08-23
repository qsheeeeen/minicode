import type { CommandHandler } from "../registry.js";
import type { CommandContext } from "../index.js";

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 40 ? flat.slice(0, 40) + "..." : flat;
}

/** Render the conversation tree as indented text. Messages on the active
 *  path are marked `*` and numbered to match /undo and /fork; branched-off
 *  messages keep their position but have no number (they are not in the
 *  context). */
export const treeCommand: CommandHandler = {
  name: "tree",
  description: "Show the session conversation tree",
  handler: async (_args, ctx): Promise<void> => {
    const tree = ctx.sessionManager.getTree();
    if (tree.entries().length === 0) {
      ctx.sessionManager.reportStatus({
        role: "status",
        content: "(Session tree is empty)",
      });
      return;
    }

    const activePath = tree.activePath();
    const activeIds = new Set(activePath.map((turn) => turn.id));
    const ordinalById = new Map(
      activePath.map((turn, i) => [turn.id, i + 1] as const),
    );

    const lines = [
      "Session tree (* = active path; numbers match /undo and /fork):",
    ];
    const render = (parentId: string | null, depth: number): void => {
      for (const child of tree.childrenOf(parentId)) {
        const user = child.blocks[0] as { text?: string } | undefined;
        const marker = activeIds.has(child.id) ? "*" : " ";
        const ordinal = ordinalById.get(child.id);
        const label = ordinal !== undefined ? `${ordinal}. ` : "";
        lines.push(
          `${"  ".repeat(depth)}${marker}${label}"${preview(user?.text ?? "(unknown)")}"`,
        );
        render(child.id, depth + 1);
      }
    };
    render(null, 0);

    ctx.sessionManager.reportStatus({
      role: "status",
      content: lines.join("\n"),
    });
  },
};
