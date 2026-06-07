import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import {
  ChatInput,
  EffortSelectInput,
  SessionListInput,
  getInputComponent,
  inputComponents,
  type InputComponentProps,
} from "./inputs.js";

describe("ChatInput", () => {
  it("renders with placeholder", () => {
    const { lastFrame } = render(
      <ChatInput onSubmit={() => {}} value="" onChange={() => {}} />,
    );
    expect(lastFrame()).toContain("Type a message");
  });
});

describe("EffortSelectInput", () => {
  it("renders effort options", () => {
    const { lastFrame } = render(
      <EffortSelectInput onExecute={() => {}} onCancel={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("Effort:");
    expect(output).toContain("low");
    expect(output).toContain("medium");
    expect(output).toContain("high");
    expect(output).toContain("xhigh");
    expect(output).toContain("max");
  });

  it("shows navigation hint", () => {
    const { lastFrame } = render(
      <EffortSelectInput onExecute={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()).toContain("navigate");
  });
});

describe("SessionListInput", () => {
  it("renders session names", () => {
    const sessions = [{ name: "session-a" }, { name: "session-b" }];
    const { lastFrame } = render(
      <SessionListInput
        onExecute={() => {}}
        onCancel={() => {}}
        sessions={sessions}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Sessions:");
    expect(output).toContain("session-a");
    expect(output).toContain("session-b");
  });

  it("shows 'No sessions found' when empty", () => {
    const { lastFrame } = render(
      <SessionListInput
        onExecute={() => {}}
        onCancel={() => {}}
        sessions={[]}
      />,
    );
    expect(lastFrame()).toContain("No sessions found");
  });
});

describe("getInputComponent", () => {
  it("returns ChatInput for 'chat'", () => {
    expect(getInputComponent("chat")).toBe(ChatInput);
  });

  it("returns ChatInput as default fallback", () => {
    expect(getInputComponent("nonexistent")).toBe(ChatInput);
  });

  it("returns correct component for registered names", () => {
    for (const reg of inputComponents) {
      expect(getInputComponent(reg.name)).toBe(reg.Component);
    }
  });
});

describe("inputComponents registry", () => {
  it("contains expected registrations", () => {
    const names = inputComponents.map((c) => c.name);
    expect(names).toContain("chat");
    expect(names).toContain("effort-select");
    expect(names).toContain("session-list");
    expect(names).toContain("model-select");
    expect(names).toContain("undo");
  });
});
