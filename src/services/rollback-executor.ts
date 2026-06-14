import fs from "fs/promises";
import type { ChangeEntry, ChangeJournal } from "./change-journal.js";
import type { LLMContext } from "../llm/context.js";

export interface RollbackResult {
  filesRestored: string[];
  filesDeleted: string[];
}

export class RollbackExecutor {
  async rollbackConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackResult> {
    this.truncateConversation(context, fromUserMessageOrdinal);
    await changeJournal.pruneFrom(fromUserMessageOrdinal);
    return { filesRestored: [], filesDeleted: [] };
  }

  async rollbackFilesAndConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackResult> {
    // Step 1: Restore files
    const result = await this.restoreFiles(
      changeJournal,
      fromUserMessageOrdinal,
    );
    // Step 2: Truncate conversation
    this.truncateConversation(context, fromUserMessageOrdinal);
    // Step 3: Prune journal (last — only after everything else succeeds)
    await changeJournal.pruneFrom(fromUserMessageOrdinal);
    return result;
  }

  private async restoreFiles(
    changeJournal: ChangeJournal,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackResult> {
    const entries = await changeJournal.getEntries();
    const affected = entries.filter((e) => e.turnIdx >= fromUserMessageOrdinal);

    if (affected.length === 0) {
      return { filesRestored: [], filesDeleted: [] };
    }

    // For each unique path, use the earliest entry to get the before state
    const pathMap = new Map<string, ChangeEntry>();
    for (const e of affected) {
      if (!pathMap.has(e.path)) {
        pathMap.set(e.path, e);
      }
    }

    const result: RollbackResult = {
      filesRestored: [],
      filesDeleted: [],
    };

    for (const [filePath, entry] of pathMap) {
      if (entry.before === "") {
        try {
          await fs.unlink(filePath);
          result.filesDeleted.push(filePath);
        } catch {
          // Already deleted
        }
      } else {
        await fs.writeFile(filePath, entry.before, "utf-8");
        result.filesRestored.push(filePath);
      }
    }

    return result;
  }

  private truncateConversation(
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): void {
    context.truncateBeforeUserMessageOrdinal(fromUserMessageOrdinal);
  }
}
