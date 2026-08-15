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
