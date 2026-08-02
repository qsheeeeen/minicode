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
import { registerCommand } from "../registry.js";

/**
 * Register every built-in slash command. Explicitly called by the composition
 * root (and tests); importing command modules never mutates state by itself.
 */
export function registerAllCommands(): void {
  registerCommand(exitCommand);
  registerCommand(clearCommand);
  registerCommand(compressCommand);
  registerCommand(effortCommand);
  registerCommand(newCommand);
  registerCommand(renameCommand);
  registerCommand(resumeCommand);
  registerCommand(planCommand);
  registerCommand(testCommand);
  registerCommand(skillsCommand);
  registerCommand(modelCommand);
  registerCommand(undoCommand);
}
