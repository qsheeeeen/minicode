import { describe, it, expect } from "vitest";

describe("Panel Component", () => {
  it("exports Panel function", async () => {
    const mod = await import("./Panel.js");
    expect(typeof mod.Panel).toBe("function");
  });
});
