import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Status } from "./Status.js";
import { TuiProvider } from "./store.js";

describe("Status Component", () => {
  it("renders nothing when not loading", () => {
    const { lastFrame } = render(
      <TuiProvider initialState={{ isLoading: false }}>
        <Status />
      </TuiProvider>,
    );
    expect(lastFrame()).toBe("");
  });

  it("shows 'Thinking...' when loading without pending prompt", () => {
    const { lastFrame } = render(
      <TuiProvider initialState={{ isLoading: true, pendingPrompt: null }}>
        <Status />
      </TuiProvider>,
    );
    expect(lastFrame()).toContain("Thinking...");
  });

  it("shows 'Waiting for user...' when loading with pending prompt", () => {
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          isLoading: true,
          pendingPrompt: {
            type: "text",
            message: "confirm?",
            resolve: () => {},
          } as any,
        }}
      >
        <Status />
      </TuiProvider>,
    );
    expect(lastFrame()).toContain("Waiting for user...");
  });
});
