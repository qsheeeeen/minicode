import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import {
  ChatInput,
  EffortSelectInput,
  ForkInput,
  ModelSelectInput,
  SessionListInput,
} from "./inputs.js";
import { getInputComponent, inputModes } from "./input-modes.js";

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

  it("returns correct component for registered modes", () => {
    for (const [mode, def] of Object.entries(inputModes)) {
      expect(getInputComponent(mode)).toBe(def.Component);
    }
  });
});

describe("inputModes registry", () => {
  it("declares the expected modes", () => {
    expect(Object.keys(inputModes)).toEqual(
      expect.arrayContaining([
        "chat",
        "effort-select",
        "session-list",
        "model-select",
        "undo",
        "fork",
      ]),
    );
  });
});

describe("ModelSelectInput", () => {
  it("renders tier mappings with the active marker and edit entry", () => {
    const { lastFrame } = render(
      <ModelSelectInput
        onExecute={() => {}}
        onCancel={() => {}}
        providers={{}}
        tiers={{ pro: "glm-4.7@zhipu", flash: "glm-4-flash@zhipu" }}
        activeTier="pro"
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Pro → glm-4.7@zhipu (active)");
    expect(output).toContain("Flash → glm-4-flash@zhipu");
    expect(output).toContain("Edit tier mapping...");
  });

  it("marks unset tiers", () => {
    const { lastFrame } = render(
      <ModelSelectInput
        onExecute={() => {}}
        onCancel={() => {}}
        providers={{}}
        tiers={{}}
        activeTier="pro"
      />,
    );
    expect(lastFrame()).toContain("Flash → (unset)");
  });
});

describe("ForkInput", () => {
  it("renders user messages newest-first with a cancel entry", () => {
    const { lastFrame } = render(
      <ForkInput
        onExecute={() => {}}
        onCancel={() => {}}
        messageIds={["u1", "u2"]}
        userMessages={["first", "second"]}
      />,
    );
    const output = lastFrame();
    expect(output).toContain("Fork to before a user message");
    expect(output).toContain('"first"');
    expect(output).toContain('"second"');
    expect(output).toContain("Cancel");
  });

  it("shows 'Nothing to fork' when empty", () => {
    const { lastFrame } = render(
      <ForkInput onExecute={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()).toContain("Nothing to fork");
  });
});
