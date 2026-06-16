import type { Model } from "../../llm/model.js";
import type { EffortLevel } from "../../llm/client.js";
import type { AppConfig } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import { useTuiState } from "./state.js";

export interface ModeHandlerDeps {
  model: Model;
  config: AppConfig;
  modelSwitchService: ModelSwitchService;
  handleSubmit: (value: string) => Promise<boolean>;
}

export type ModeHandler = (
  value: string,
  deps: ModeHandlerDeps,
) => Promise<void>;

async function effortSelectHandler(
  value: string,
  { model, config }: ModeHandlerDeps,
): Promise<void> {
  model.setEffort(value as EffortLevel);
  config.setEffort(value as EffortLevel);
  useTuiState.setState((state) => ({
    messages: [
      ...state.messages,
      {
        role: "status",
        content: `(Effort set to: ${value})`,
        timestamp: new Date(),
      },
    ],
  }));
}

async function sessionListHandler(
  value: string,
  { handleSubmit }: ModeHandlerDeps,
): Promise<void> {
  handleSubmit(`/resume ${value}`);
}

async function modelSelectHandler(
  value: string,
  { config, modelSwitchService }: ModeHandlerDeps,
): Promise<void> {
  const tierMatch = value.match(/^(pro|flash):(.*)$/);
  if (tierMatch) {
    const tier = tierMatch[1];
    let modelSpec = tierMatch[2];

    if (!modelSpec) {
      modelSpec = config.tiers[tier] || "";
    }

    if (modelSpec) {
      try {
        await modelSwitchService.switchAgentModel({
          modelSpec,
          tier: tierMatch[2] ? tier : undefined,
        });
      } catch (error) {
        useTuiState.setState((state) => ({
          messages: [
            ...state.messages,
            {
              role: "error",
              content: `(Error: ${error instanceof Error ? error.message : String(error)})`,
              timestamp: new Date(),
            },
          ],
        }));
      }
    }
  }
}

export const modeHandlers: Record<string, ModeHandler> = {
  "effort-select": effortSelectHandler,
  "session-list": sessionListHandler,
  "model-select": modelSelectHandler,
};
