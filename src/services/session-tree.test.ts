import { describe, it, expect } from "vitest";
import { SessionTree, splitSegments } from "./session-tree.js";
import type { LLMBlock } from "../core/blocks.js";

function blocks(...parts: string[]): LLMBlock[] {
  return parts.map((text, i) =>
    i % 2 === 0
      ? { type: "user" as const, text, id: text }
      : { type: "text" as const, text },
  );
}

describe("splitSegments", () => {
  it("splits at user blocks and folds followers into the segment", () => {
    const segments = splitSegments([
      { type: "user", text: "one", id: "u1" },
      { type: "text", text: "r1" },
      { type: "user", text: "two", id: "u2" },
      { type: "text", text: "r2a" },
      { type: "text", text: "r2b" },
    ]);
    expect(segments.map((s) => s.messageId)).toEqual(["u1", "u2"]);
    expect(segments[1].blocks).toHaveLength(3);
  });

  it("returns empty for an empty context", () => {
    expect(splitSegments([])).toEqual([]);
  });
});

describe("SessionTree", () => {
  it("fromBlocks builds a single chain keyed by user-block ids", () => {
    const tree = SessionTree.fromBlocks(
      blocks("u1", "r1", "u2", "r2"),
    );
    expect(tree.activePath().map((t) => t.id)).toEqual(["u1", "u2"]);
    expect(tree.get("u2")!.parentId).toBe("u1");
    expect(tree.activePathBlocks()).toEqual(blocks("u1", "r1", "u2", "r2"));
  });

  it("fromTurns honors the persisted active turn and nulls unknown ones", () => {
    const turns = [
      { type: "turn" as const, id: "u1", parentId: null, ts: 1, blocks: [] },
      { type: "turn" as const, id: "u2", parentId: "u1", ts: 2, blocks: [] },
    ];
    expect(SessionTree.fromTurns(turns, "u1").activeTurnId).toBe("u1");
    expect(SessionTree.fromTurns(turns, "missing").activeTurnId).toBeNull();
    expect(SessionTree.fromTurns(turns, null).activeTurnId).toBeNull();
  });

  it("appendTurn is idempotent on message id", () => {
    const tree = SessionTree.empty();
    tree.appendTurn("u1", blocks("u1", "r1"));
    tree.appendTurn("u1", blocks("u1", "r1", "more"));
    expect(tree.entries()).toHaveLength(1);
    expect(tree.get("u1")!.blocks).toHaveLength(2); // first append wins
  });

  it("setActiveTurn moves the pointer (fork) without deleting branches", () => {
    const tree = SessionTree.empty();
    tree.appendTurn("u1", blocks("u1", "r1"));
    tree.appendTurn("u2", blocks("u2", "r2"));
    tree.setActiveTurn("u1");
    tree.appendTurn("u3", blocks("u3", "r3")); // sibling of u2

    expect(tree.activePath().map((t) => t.id)).toEqual(["u1", "u3"]);
    expect(tree.childrenOf("u1").map((t) => t.id)).toEqual(["u2", "u3"]);
    expect(tree.has("u2")).toBe(true); // branch preserved
  });

  it("setActiveTurn throws on unknown ids", () => {
    const tree = SessionTree.empty();
    expect(() => tree.setActiveTurn("nope")).toThrow(/unknown turn/);
  });

  it("truncateFrom removes the subtree and falls back to the parent", () => {
    const tree = SessionTree.empty();
    tree.appendTurn("u1", blocks("u1", "r1"));
    tree.appendTurn("u2", blocks("u2", "r2"));
    tree.setActiveTurn("u2");
    tree.appendTurn("u3", blocks("u3", "r3")); // child of u2
    tree.setActiveTurn("u3");

    tree.truncateFrom("u2");

    expect(tree.has("u2")).toBe(false);
    expect(tree.has("u3")).toBe(false);
    expect(tree.activeTurnId).toBe("u1");
    expect(tree.activePath().map((t) => t.id)).toEqual(["u1"]);
  });

  it("truncateFrom keeps unrelated branches above the cut", () => {
    const tree = SessionTree.empty();
    tree.appendTurn("u1", blocks("u1"));
    tree.setActiveTurn("u1");
    tree.appendTurn("u2a", blocks("u2a"));
    tree.setActiveTurn("u1");
    tree.appendTurn("u2b", blocks("u2b"));

    tree.truncateFrom("u2a");

    expect(tree.has("u2a")).toBe(false);
    expect(tree.has("u2b")).toBe(true);
    expect(tree.activeTurnId).toBe("u2b");
  });
});
