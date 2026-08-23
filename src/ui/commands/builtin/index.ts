import { exitCommand } from "./exit.js";
import { clearCommand } from "./clear.js";
import { compressCommand } from "./compress.js";
import { effortCommand } from "./effort.js";
import { newCommand } from "./new.js";
import { renameCommand } from "./rename.js";
import { resumeCommand } from "./resume.js";
import { planCommand } from "./plan.js";
import { testCommand } from "./test.js";
import { skillsCommand } from "./skills.js";
import { modelCommand } from "./model.js";
import { undoCommand } from "./undo.js";
import { forkCommand } from "./fork.js";
import { treeCommand } from "./tree.js";
import type { CommandRegistry } from "../registry.js";

/**
 * Register every built-in slash command. Explicitly called by the composition
 * root (and tests); importing command modules never mutates state by itself.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register(exitCommand);
  registry.register(clearCommand);
  registry.register(compressCommand);
  registry.register(effortCommand);
  registry.register(newCommand);
  registry.register(renameCommand);
  registry.register(resumeCommand);
  registry.register(planCommand);
  registry.register(testCommand);
  registry.register(skillsCommand);
  registry.register(modelCommand);
  registry.register(undoCommand);
  registry.register(forkCommand);
  registry.register(treeCommand);
}
