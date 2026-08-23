import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { useTuiState, initialState } from "./state.js";
import { Panel } from "./Panel.js";
import { Model } from "../../llm/model.js";

const MODEL = new Model("claude-sonnet-4-5", "anthropic", 200000);

function statusLine(): string {
  const { lastFrame } = render(<Panel model={MODEL} />);
  return lastFrame()!.split("\n")[1]!;
}

describe("Panel", () => {
  beforeEach(() => {
    useTuiState.setState({ ...initialState, tokenCount: 24000 });
  });

  it("hides the cache ratio when no cache data exists", () => {
    useTuiState.setState({ cacheHitRatio: null });
    expect(statusLine()).not.toContain("cache");
  });

  it("shows context usage as token counts and a percentage", () => {
    useTuiState.setState({ cacheHitRatio: 0.87 });
    const line = statusLine();
    expect(line).toContain("24k/200k");
    expect(line).toContain("12%");
  });

  it("shows the cache ratio as a rounded percentage", () => {
    useTuiState.setState({ cacheHitRatio: 0.873 });
    const line = statusLine();
    expect(line).toContain("cache");
    expect(line).toContain("87%");
  });

  it("renders 100% without decimals", () => {
    useTuiState.setState({ cacheHitRatio: 1 });
    expect(statusLine()).toContain("100%");
  });
});
