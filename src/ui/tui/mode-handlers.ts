import type { Agent } from "../../agent.js";
import type { EffortLevel } from "../../llm/client.js";
import type { AppConfig } from "../../config.js";
import type { ModelFactory } from "../../llm/model.js";

export interface ModeHandlerDeps {
  agentRef: React.MutableRefObject<Agent>;
  config: AppConfig;
  modelFactory: ModelFactory;
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
  { handleSubmit, dispatch }: ModeHandlerDeps,
): Promise<void> {
  handleSubmit(`/resume ${value}`);
}

async function modelSelectHandler(
  value: string,
  { agentRef, config, modelFactory, dispatch }: ModeHandlerDeps,
): Promise<void> {
  const tierMatch = value.match(/^(pro|flash):(.*)$/);
  if (tierMatch) {
    const tier = tierMatch[1];
    let modelSpec = tierMatch[2];

    if (!modelSpec) {
      modelSpec = config.tiers[tier] || "";
    }

    if (modelSpec) {
      const newModel = modelFactory.fromSpec(modelSpec);
      if (newModel) {
        agentRef.current.model = newModel;
        await config.setModel(modelSpec);
        if (tierMatch[2]) {
          await config.setTier(tier, modelSpec);
        }
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            role: "status",
            content: `(Model set to: ${modelSpec})`,
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
