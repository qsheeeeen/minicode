import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { ModalPrompter } from "./ModalPrompter.js";
import { TuiProvider } from "./store.js";

describe("ModalPrompter Component", () => {
  it("returns null if there is no pending prompt", () => {
    const { lastFrame } = render(
      <TuiProvider initialState={{ pendingPrompt: null }}>
        <ModalPrompter />
      </TuiProvider>,
    );
    expect(lastFrame()).toBe("");
  });

  it("renders a pending prompt correctly", () => {
    const mockResolve = vi.fn();
    const { lastFrame } = render(
      <TuiProvider
        initialState={{
          pendingPrompt: {
            message: "Please choose:",
            type: "choice",
            options: [{ label: "Option A", value: "a", description: "Desc A" }],
            resolve: mockResolve,
          },
        }}
      >
        <ModalPrompter />
      </TuiProvider>,
    );

    const output = lastFrame();
    expect(output).toContain("Please choose:");
    expect(output).toContain("Option A");
    expect(output).toContain("Desc A");
  });
});
