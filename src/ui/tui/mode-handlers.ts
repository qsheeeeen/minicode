import type { Model } from "../../llm/model.js";
import type { EffortLevel } from "../../llm/client.js";
import type { AppConfig } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { SessionManager } from "../../services/session-manager.js";

export interface ModeHandlerDeps {
  model: Model;
  config: AppConfig;
  modelSwitchService: ModelSwitchService;
  sessionManager: SessionManager;
  handleSubmit: (value: string) => Promise<boolean>;
}

export type ModeHandler = (
  value: string,
  deps: ModeHandlerDeps,
) => Promise<void>;

export async function effortSelectHandler(
  value: string,
  { model, config, sessionManager }: ModeHandlerDeps,
): Promise<void> {
  model.setEffort(value as EffortLevel);
  config.setEffort(value as EffortLevel);
  // Status goes through the event bus; the timeline owns the messages array,
  // so writing useTuiState.messages directly here would be wiped by the next
  // timeline.sync().
  sessionManager.reportStatus({
    role: "status",
    content: `(Effort set to: ${value})`,
    timestamp: new Date(),
  });
}

export async function sessionListHandler(
  value: string,
  { handleSubmit }: ModeHandlerDeps,
): Promise<void> {
  handleSubmit(`/resume ${value}`);
}

export async function modelSelectHandler(
  value: string,
  { config, modelSwitchService, sessionManager }: ModeHandlerDeps,
): Promise<void> {
  const tierMatch = value.match(/^(pro|flash):(.*)$/);
  if (tierMatch) {
    const tier = tierMatch[1];
    let modelSpec = tierMatch[2];

    if (!modelSpec) {
      modelSpec = config.tiers[tier] || "";
    }

    if (modelSpec) {
      const result = await modelSwitchService.switchAgentModel({
        modelSpec,
        tier: tierMatch[2] ? tier : undefined,
      });
      if (!result.ok) {
        sessionManager.reportStatus({
          role: "error",
          content: `(Error: ${result.reason})`,
          timestamp: new Date(),
        });
      }
    }
  }
}
