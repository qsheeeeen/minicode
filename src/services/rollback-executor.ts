import fs from "fs/promises";
import type { ChangeEntry, ChangeJournal } from "./change-journal.js";
import type { LLMContext } from "../core/context.js";

export interface RollbackResult {
  filesRestored: string[];
  filesDeleted: string[];
}

/** Rollback never throws: a conflict is a step failure carried as a value,
 *  with `partial` reporting what was already restored before it. */
export type RollbackOutcome =
  | { ok: true; result: RollbackResult }
  | { ok: false; reason: string; partial: RollbackResult };

/** Legal rollback scopes — the executor's vocabulary, not the UI's. */
export const ROLLBACK_SCOPES = ["conversation", "both"] as const;
export type RollbackScope = (typeof ROLLBACK_SCOPES)[number];

export function isRollbackScope(value: string): value is RollbackScope {
  return (ROLLBACK_SCOPES as readonly string[]).includes(value);
}

const EMPTY_RESULT: RollbackResult = { filesRestored: [], filesDeleted: [] };

function fail(
  e: unknown,
  partial: RollbackResult = EMPTY_RESULT,
): RollbackOutcome {
  return {
    ok: false,
    reason: e instanceof Error ? e.message : String(e),
    partial,
  };
}

/** The user messages at and after the target — derived from the context's
 *  ordered summaries, so both the file and conversation cuts share one
 *  definition of "after". */
function messagesFrom(
  context: LLMContext,
  fromMessageId: string,
): Set<string> {
  const summaries = context.getUserMessageSummaries();
  const ids = new Set<string>();
  let cutting = false;
  for (const s of summaries) {
    if (s.id === fromMessageId) cutting = true;
    if (cutting) ids.add(s.id);
  }
  return ids;
}

export class RollbackExecutor {
  async rollbackConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromMessageId: string,
  ): Promise<RollbackOutcome> {
    const removeIds = messagesFrom(context, fromMessageId);
    try {
      context.truncateBeforeUserMessageId(fromMessageId);
      await changeJournal.pruneByMessageIds(removeIds);
      return { ok: true, result: EMPTY_RESULT };
    } catch (e) {
      return fail(e);
    }
  }

  /** Dispatch on scope — the single place that knows what "both" means. */
  async rollback(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromMessageId: string,
    scope: RollbackScope,
  ): Promise<RollbackOutcome> {
    return scope === "both"
      ? this.rollbackFilesAndConversation(
          changeJournal,
          context,
          fromMessageId,
        )
      : this.rollbackConversation(changeJournal, context, fromMessageId);
  }

  async rollbackFilesAndConversation(
    changeJournal: ChangeJournal,
    context: LLMContext,
    fromMessageId: string,
  ): Promise<RollbackOutcome> {
    const removeIds = messagesFrom(context, fromMessageId);

    // Step 1: Restore files (may partially apply before a conflict — on
    // failure the conversation and journal are left untouched).
    const restore = await this.restoreFiles(changeJournal, removeIds);
    if (!restore.ok) return restore;

    // Step 2: Truncate conversation. Step 3: Prune journal (last — only
    // after everything else succeeded).
    try {
      context.truncateBeforeUserMessageId(fromMessageId);
      await changeJournal.pruneByMessageIds(removeIds);
    } catch (e) {
      return fail(e, restore.result);
    }
    return { ok: true, result: restore.result };
  }

  private async restoreFiles(
    changeJournal: ChangeJournal,
    removeIds: ReadonlySet<string>,
  ): Promise<RollbackOutcome> {
    const entries = await changeJournal.getEntries();
    const affected = entries.filter((e) => removeIds.has(e.userMessageId));

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
}
