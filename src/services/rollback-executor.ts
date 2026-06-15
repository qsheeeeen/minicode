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
    await changeJournal.pruneFromUserMessage(fromUserMessageOrdinal);
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
    await changeJournal.pruneFromUserMessage(fromUserMessageOrdinal);
    return result;
  }

  private async restoreFiles(
    changeJournal: ChangeJournal,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackResult> {
    const entries = await changeJournal.getEntries();
    const affected = entries.filter(
      (e) => e.userMessageOrdinal >= fromUserMessageOrdinal,
    );

    if (affected.length === 0) {
      return { filesRestored: [], filesDeleted: [] };
    }

    const filesRestored = new Set<string>();
    const filesDeleted = new Set<string>();

    for (const entry of [...affected].reverse()) {
      if (entry.op === "write" && !entry.beforeExists) {
        await this.deleteCreatedFile(entry.path);
        filesDeleted.add(entry.path);
        continue;
      }

      await this.revertEntry(entry);
      filesRestored.add(entry.path);
    }

    return {
      filesRestored: [...filesRestored],
      filesDeleted: [...filesDeleted],
    };
  }

  private async revertEntry(entry: ChangeEntry): Promise<void> {
    let content = await fs.readFile(entry.path, "utf-8");
    for (const range of [...entry.ranges].reverse()) {
      const actual = content.slice(
        range.start,
        range.start + range.newText.length,
      );
      if (actual !== range.newText) {
        throw new Error(
          `Rollback conflict in ${entry.path}: expected current text at offset ${range.start} to match journal entry`,
        );
      }
      content =
        content.slice(0, range.start) +
        range.oldText +
        content.slice(range.start + range.newText.length);
    }
    await fs.writeFile(entry.path, content, "utf-8");
  }

  private async deleteCreatedFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private truncateConversation(
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): void {
    context.truncateBeforeUserMessageOrdinal(fromUserMessageOrdinal);
  }
}
