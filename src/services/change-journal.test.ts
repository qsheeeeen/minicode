import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("fs", () => ({
  default: {
    createWriteStream: vi.fn().mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

describe("ChangeJournal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startSession creates directory and opens write stream", async () => {
    const fs = (await import("fs/promises")).default;
    const fsSync = (await import("fs")).default;
    const { ChangeJournal } = await import("./change-journal.js");

    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/sess", { recursive: true });
    expect(fsSync.createWriteStream).toHaveBeenCalledWith(
      "/tmp/sess/test.changes.jsonl",
      { flags: "a", encoding: "utf-8" },
    );
  });

  it("recordBefore writes JSON line to stream", async () => {
    const fsSync = (await import("fs")).default;
    const mockWrite = vi.fn();
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: mockWrite,
      end: vi.fn(),
    });

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    vi.spyOn(Date, "now").mockReturnValue(1000);
    journal.recordBefore(1, "file.ts", "edit", "old content");

    expect(mockWrite).toHaveBeenCalledWith(
      JSON.stringify({
        turnIdx: 1,
        path: "file.ts",
        op: "edit",
        before: "old content",
        ts: 1000,
      }) + "\n",
    );
  });

  it("recordBefore is no-op when no write stream", async () => {
    // Should not throw
    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    journal.recordBefore(1, "file.ts", "edit", "content");
  });

  it("getEntries loads from file when no cache", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        turnIdx: 1,
        path: "a.ts",
        op: "edit",
        before: "old",
        ts: 100,
      }),
      JSON.stringify({
        turnIdx: 2,
        path: "b.ts",
        op: "write",
        before: "",
        ts: 200,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    // Set filePath via startSession
    const fsSync = (await import("fs")).default;
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    await journal.startSession("/tmp/sess", "test");

    const entries = await journal.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("a.ts");
    expect(entries[1].path).toBe("b.ts");
  });

  it("getEntries returns cache on second call", async () => {
    const fs = (await import("fs/promises")).default;
    const line = JSON.stringify({
      turnIdx: 1,
      path: "a.ts",
      op: "edit",
      before: "old",
      ts: 100,
    });
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(line);

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    const fsSync = (await import("fs")).default;
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    await journal.startSession("/tmp/sess", "test");

    await journal.getEntries();
    await journal.getEntries();

    // readFile should only be called once (cache hit on second call)
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it("getEntriesByTurn groups entries by turnIdx", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        turnIdx: 1,
        path: "a.ts",
        op: "edit",
        before: "old",
        ts: 100,
      }),
      JSON.stringify({
        turnIdx: 1,
        path: "b.ts",
        op: "write",
        before: "",
        ts: 200,
      }),
      JSON.stringify({
        turnIdx: 2,
        path: "c.ts",
        op: "edit",
        before: "x",
        ts: 300,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    const fsSync = (await import("fs")).default;
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    await journal.startSession("/tmp/sess", "test");

    const map = await journal.getEntriesByTurn();
    expect(map.get(1)).toHaveLength(2);
    expect(map.get(2)).toHaveLength(1);
  });

  it("pruneFrom removes entries at or after turnIdx", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        turnIdx: 1,
        path: "a.ts",
        op: "edit",
        before: "old",
        ts: 100,
      }),
      JSON.stringify({
        turnIdx: 2,
        path: "b.ts",
        op: "edit",
        before: "x",
        ts: 200,
      }),
      JSON.stringify({
        turnIdx: 3,
        path: "c.ts",
        op: "edit",
        before: "y",
        ts: 300,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    const fsSync = (await import("fs")).default;
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    await journal.startSession("/tmp/sess", "test");

    await journal.pruneFrom(2);

    // Should write only entry with turnIdx 1
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      expect.stringContaining('"turnIdx":1'),
    );
  });

  it("pruneAndRenumber filters and renumbers entries", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        turnIdx: 1,
        path: "a.ts",
        op: "edit",
        before: "old",
        ts: 100,
      }),
      JSON.stringify({
        turnIdx: 2,
        path: "b.ts",
        op: "edit",
        before: "x",
        ts: 200,
      }),
      JSON.stringify({
        turnIdx: 3,
        path: "c.ts",
        op: "edit",
        before: "y",
        ts: 300,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    const fsSync = (await import("fs")).default;
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    });
    await journal.startSession("/tmp/sess", "test");

    await journal.pruneAndRenumber(1, 0);

    const written = (fs.writeFile as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    const kept = written
      .trim()
      .split("\n")
      .map((l: string) => JSON.parse(l));
    expect(kept).toHaveLength(2);
    expect(kept[0].turnIdx).toBe(1); // was 2, renumbered: 2 - 1 + 0 = 1
    expect(kept[1].turnIdx).toBe(2); // was 3, renumbered: 3 - 1 + 0 = 2
  });

  it("close ends the write stream", async () => {
    const fsSync = (await import("fs")).default;
    const mockEnd = vi.fn();
    (fsSync.createWriteStream as ReturnType<typeof vi.fn>).mockReturnValue({
      write: vi.fn(),
      end: mockEnd,
    });

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");
    journal.close();

    expect(mockEnd).toHaveBeenCalled();
  });

  it("close is safe to call multiple times", async () => {
    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    journal.close(); // no stream
    journal.close(); // still no stream — should not throw
  });
});
