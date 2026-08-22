// Single registration site for interactive input modes: what a mode renders
// and how its selection is processed, declared together. Adding a picker is
// component + handler + one entry here (+ the typed InputRequest variant in
// commands/index.ts); no other file enumerates mode names.

import type React from "react";
import {
  ChatInput,
  EffortSelectInput,
  SessionListInput,
  ModelSelectInput,
  UndoInput,
  type InputComponentProps,
} from "./inputs.js";
import {
  effortSelectHandler,
  sessionListHandler,
  modelSelectHandler,
  type ModeHandler,
} from "./mode-handlers.js";
import type { InputRequest } from "../commands/index.js";

export interface InputModeDef {
  Component: React.ComponentType<InputComponentProps>;
  /** Selection handler; modes without one (undo) feed back through
   *  onExecute into the command layer. */
  handler?: ModeHandler;
}

export const inputModes: Record<string, InputModeDef> = {
  chat: { Component: ChatInput },
  "effort-select": {
    Component: EffortSelectInput,
    handler: effortSelectHandler,
  },
  "session-list": {
    Component: SessionListInput,
    handler: sessionListHandler,
  },
  "model-select": {
    Component: ModelSelectInput,
    handler: modelSelectHandler,
  },
  undo: { Component: UndoInput },
};

export function getInputComponent(
  mode: string,
): React.ComponentType<InputComponentProps> {
  return inputModes[mode]?.Component ?? ChatInput;
}

export function getInputModeHandler(mode: string): ModeHandler | undefined {
  return inputModes[mode]?.handler;
}

/**
 * Map an InputRequest onto a mode + props for the input-modes registry —
 * TUI rendering policy, kept next to the mode vocabulary it feeds.
 */
export function inputRequestToState(request: InputRequest): {
  mode: string;
  props: Record<string, unknown>;
} {
  switch (request.type) {
    case "effort-picker":
      return { mode: "effort-select", props: {} };
    case "session-picker":
      return {
        mode: "session-list",
        props: { sessions: request.sessions },
      };
    case "model-picker":
      return {
        mode: "model-select",
        props: {
          providers: request.providers,
          tiers: request.tiers,
          activeTier: request.activeTier,
        },
      };
    case "rollback-picker":
      return {
        mode: "undo",
        props: {
          totalUserMessages: request.totalUserMessages,
          entriesByUserMessage: request.entriesByUserMessage,
          userMessages: request.userMessages,
        },
      };
  }
}
