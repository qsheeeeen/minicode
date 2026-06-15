import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: {
    appendFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("ChangeJournal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startSession creates directory and loads existing entries", async () => {
    const fs = (await import("fs/promises")).default;
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("");
    const { ChangeJournal } = await import("./change-journal.js");

    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/sess", { recursive: true });
    expect(fs.readFile).toHaveBeenCalledWith(
      "/tmp/sess/test.changes.jsonl",
      "utf-8",
    );
  });

  it("recordChange appends JSONL and updates in-memory entries", async () => {
    const fs = (await import("fs/promises")).default;
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("");
    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    vi.spyOn(Date, "now").mockReturnValue(1000);
    await journal.recordChange(1, "file.ts", "edit", true, [
      { start: 5, oldText: "old", newText: "new" },
    ]);

    const entry = {
      userMessageOrdinal: 1,
      path: "file.ts",
      op: "edit",
      beforeExists: true,
      ranges: [{ start: 5, oldText: "old", newText: "new" }],
      ts: 1000,
    };
    expect(fs.appendFile).toHaveBeenCalledWith(
      "/tmp/sess/test.changes.jsonl",
      JSON.stringify(entry) + "\n",
      "utf-8",
    );
    await expect(journal.getEntries()).resolves.toEqual([entry]);
  });

  it("recordChange is a no-op before startSession", async () => {
    const fs = (await import("fs/promises")).default;
    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();

    await journal.recordChange(1, "file.ts", "edit", true, []);

    expect(fs.appendFile).not.toHaveBeenCalled();
  });

  it("getEntries loads existing JSONL entries", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        userMessageOrdinal: 1,
        path: "a.ts",
        op: "edit",
        beforeExists: true,
        ranges: [{ start: 0, oldText: "old", newText: "new" }],
        ts: 100,
      }),
      JSON.stringify({
        userMessageOrdinal: 2,
        path: "b.ts",
        op: "write",
        beforeExists: false,
        ranges: [{ start: 0, oldText: "", newText: "created" }],
        ts: 200,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    const entries = await journal.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("a.ts");
    expect(entries[1].beforeExists).toBe(false);
  });

  it("getEntriesByUserMessage groups entries by userMessageOrdinal", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        userMessageOrdinal: 1,
        path: "a.ts",
        op: "edit",
        beforeExists: true,
        ranges: [],
        ts: 100,
      }),
      JSON.stringify({
        userMessageOrdinal: 1,
        path: "b.ts",
        op: "write",
        beforeExists: false,
        ranges: [],
        ts: 200,
      }),
      JSON.stringify({
        userMessageOrdinal: 2,
        path: "c.ts",
        op: "edit",
        beforeExists: true,
        ranges: [],
        ts: 300,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");

    const map = await journal.getEntriesByUserMessage();
    expect(map.get(1)).toHaveLength(2);
    expect(map.get(2)).toHaveLength(1);
  });

  it("pruneFromUserMessage removes entries at or after user message", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [
      JSON.stringify({
        userMessageOrdinal: 1,
        path: "a.ts",
        op: "edit",
        beforeExists: true,
        ranges: [],
        ts: 100,
      }),
      JSON.stringify({
        userMessageOrdinal: 2,
        path: "b.ts",
        op: "edit",
        beforeExists: true,
        ranges: [],
        ts: 200,
      }),
    ];
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");
    await journal.pruneFromUserMessage(2);

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".tmp"),
      expect.stringContaining('"userMessageOrdinal":1'),
    );
    await expect(journal.getEntries()).resolves.toHaveLength(1);
  });

  it("pruneAndRenumberUserMessages filters and renumbers entries", async () => {
    const fs = (await import("fs/promises")).default;
    const lines = [1, 2, 3].map((userMessageOrdinal) =>
      JSON.stringify({
        userMessageOrdinal,
        path: `${userMessageOrdinal}.ts`,
        op: "edit",
        beforeExists: true,
        ranges: [],
        ts: userMessageOrdinal,
      }),
    );
    (fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      lines.join("\n"),
    );

    const { ChangeJournal } = await import("./change-journal.js");
    const journal = new ChangeJournal();
    await journal.startSession("/tmp/sess", "test");
    await journal.pruneAndRenumberUserMessages(1, 0);

    const kept = await journal.getEntries();
    expect(kept.map((entry) => entry.userMessageOrdinal)).toEqual([1, 2]);
    expect(fs.rename).toHaveBeenCalledWith(
      "/tmp/sess/test.changes.jsonl.tmp",
      "/tmp/sess/test.changes.jsonl",
    );
  });
});
