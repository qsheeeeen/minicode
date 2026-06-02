import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Header } from "./Header.js";

describe("Header Component", () => {
  it("renders app name, version, and project path", () => {
    const { lastFrame } = render(<Header version="11.11.11.11" projectPath="/home/user/project" />);
    const output = lastFrame();
    expect(output).toContain("MiniCode");
    expect(output).toContain("(v11.11.11.11)");
    expect(output).toContain("directory: /home/user/project");
  });
});
