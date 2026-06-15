import type { Agent } from "../../agent.js";
import type { EffortLevel } from "../../llm/client.js";
import type { AppConfig } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";

export interface ModeHandlerDeps {
  agentRef: React.MutableRefObject<Agent>;
  config: AppConfig;
  modelSwitchService: ModelSwitchService;
  dispatch: (action: any) => void;
  handleSubmit: (value: string) => Promise<boolean>;
}

export type ModeHandler = (
  value: string,
  deps: ModeHandlerDeps,
) => Promise<void>;

async function effortSelectHandler(
  value: string,
  { agentRef, config, dispatch }: ModeHandlerDeps,
): Promise<void> {
  agentRef.current.model.setEffort(value as EffortLevel);
  config.setEffort(value as EffortLevel);
  dispatch({
    type: "ADD_MESSAGE",
    payload: {
      role: "status",
      content: `(Effort set to: ${value})`,
      timestamp: new Date(),
    },
  });
}

async function sessionListHandler(
  value: string,
  { handleSubmit }: ModeHandlerDeps,
): Promise<void> {
  handleSubmit(`/resume ${value}`);
}

async function modelSelectHandler(
  value: string,
  { agentRef, config, modelSwitchService, dispatch }: ModeHandlerDeps,
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
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            role: "error",
            content: `(Error: ${error instanceof Error ? error.message : String(error)})`,
            timestamp: new Date(),
          },
        });
      }
    }
  }
}

export const modeHandlers: Record<string, ModeHandler> = {
  "effort-select": effortSelectHandler,
  "session-list": sessionListHandler,
  "model-select": modelSelectHandler,
};
