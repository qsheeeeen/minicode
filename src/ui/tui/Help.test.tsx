import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Help } from "./Help.js";

describe("Help Component", () => {
  it("renders keybinding hints", () => {
    const { lastFrame } = render(<Help />);
    const output = lastFrame();
    expect(output).toContain("enter send");
    expect(output).toContain("ctrl+c abort/quit");
    expect(output).toContain("esc abort");
    expect(output).toContain("shift+tab cycle mode");
  });
});
