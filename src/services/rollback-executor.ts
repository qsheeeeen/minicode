import fs from "fs/promises";
import type { ChangeEntry, ChangeJournal } from "./change-journal.js";
import type { LLMContextManager } from "../llm-context-manager.js";

export interface RollbackResult {
  filesRestored: string[];
  filesDeleted: string[];
}

export class RollbackExecutor {
  async rollbackConversation(
    changeJournal: ChangeJournal,
    messageStore: LLMContextManager,
    fromTurnIdx: number,
  ): Promise<RollbackResult> {
    this.truncateConversation(messageStore, fromTurnIdx);
    await changeJournal.pruneFrom(fromTurnIdx);
    return { filesRestored: [], filesDeleted: [] };
  }

  async rollbackFilesAndConversation(
    changeJournal: ChangeJournal,
    messageStore: LLMContextManager,
    fromTurnIdx: number,
  ): Promise<RollbackResult> {
    // Step 1: Restore files
    const result = await this.restoreFiles(changeJournal, fromTurnIdx);
    // Step 2: Truncate conversation
    this.truncateConversation(messageStore, fromTurnIdx);
    // Step 3: Prune journal (last — only after everything else succeeds)
    await changeJournal.pruneFrom(fromTurnIdx);
    return result;
  }

  private async restoreFiles(
    changeJournal: ChangeJournal,
    fromTurnIdx: number,
  ): Promise<RollbackResult> {
    const entries = await changeJournal.getEntries();
    const affected = entries.filter((e) => e.turnIdx >= fromTurnIdx);

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
    messageStore: LLMContextManager,
    fromTurnIdx: number,
  ): void {
    const turns = messageStore.getTurns();
    let userPromptCount = 0;
    let cutAt = turns.length;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].role === "user" && typeof turns[i].content === "string") {
        userPromptCount++;
        if (userPromptCount === fromTurnIdx) {
          cutAt = i;
          break;
        }
      }
    }
    messageStore.setTurns(turns.slice(0, cutAt));
  }
}
