import fs from "fs/promises";
import type { ChangeEntry, ChangeJournal } from "./change-journal.js";
import type { LLMContext } from "../llm/context.js";

export interface RollbackResult {
  filesRestored: string[];
  filesDeleted: string[];
}

/** Rollback never throws: a conflict is a step failure carried as a value,
 *  with `partial` reporting what was already restored before it. */
export type RollbackOutcome =
  | { ok: true; result: RollbackResult }
  | { ok: false; reason: string; partial: RollbackResult };

const EMPTY_RESULT: RollbackResult = { filesRestored: [], filesDeleted: [] };

function fail(e: unknown, partial: RollbackResult = EMPTY_RESULT): RollbackOutcome {
  return {
    ok: false,
    reason: e instanceof Error ? e.message : String(e),
    partial,
  };
}

export class RollbackExecutor {
  async rollbackConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackOutcome> {
    try {
      this.truncateConversation(context, fromUserMessageOrdinal);
      await changeJournal.pruneFromUserMessage(fromUserMessageOrdinal);
      return { ok: true, result: EMPTY_RESULT };
    } catch (e) {
      return fail(e);
    }
  }

  async rollbackFilesAndConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackOutcome> {
    // Step 1: Restore files (may partially apply before a conflict — on
    // failure the conversation and journal are left untouched).
    const restore = await this.restoreFiles(
      changeJournal,
      fromUserMessageOrdinal,
    );
    if (!restore.ok) return restore;

    // Step 2: Truncate conversation. Step 3: Prune journal (last — only
    // after everything else succeeded).
    try {
      this.truncateConversation(context, fromUserMessageOrdinal);
      await changeJournal.pruneFromUserMessage(fromUserMessageOrdinal);
    } catch (e) {
      return fail(e, restore.result);
    }
    return { ok: true, result: restore.result };
  }

  private async restoreFiles(
    changeJournal: ChangeJournal,
    fromUserMessageOrdinal: number,
  ): Promise<RollbackOutcome> {
    const entries = await changeJournal.getEntries();
    const affected = entries.filter(
      (e) => e.userMessageOrdinal >= fromUserMessageOrdinal,
    );

    if (affected.length === 0) {
      return { ok: true, result: EMPTY_RESULT };
    }

    const filesRestored = new Set<string>();
    const filesDeleted = new Set<string>();

    for (const entry of [...affected].reverse()) {
      try {
        if (entry.op === "write" && !entry.beforeExists) {
          await this.deleteCreatedFile(entry.path);
          filesDeleted.add(entry.path);
          continue;
        }
        await this.revertEntry(entry);
        filesRestored.add(entry.path);
      } catch (e) {
        return fail(e, {
          filesRestored: [...filesRestored],
          filesDeleted: [...filesDeleted],
        });
      }
    }

    return {
      ok: true,
      result: {
        filesRestored: [...filesRestored],
        filesDeleted: [...filesDeleted],
      },
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
