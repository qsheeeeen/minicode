import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Header } from "./Header.js";

describe("Header Component", () => {
  it("renders app name and version", () => {
    const { lastFrame } = render(<Header version="1.2.3" />);
    const output = lastFrame();
    expect(output).toContain("minicode");
    expect(output).toContain("v1.2.3");
  });
});
