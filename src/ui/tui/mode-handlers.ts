import type { Model } from "../../llm/model.js";
import type { EffortLevel } from "../../llm/client.js";
import { TIERS, type AppConfig, type Tier } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { SessionManager } from "../../services/session-manager.js";

export interface ModeHandlerDeps {
  model: Model;
  config: AppConfig;
  modelSwitchService: ModelSwitchService;
  sessionManager: SessionManager;
  handleSubmit: (value: string) => Promise<boolean>;
}

const TIER_VALUE = new RegExp(`^(${TIERS.join("|")}):(.*)$`);

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
  { modelSwitchService, sessionManager }: ModeHandlerDeps,
): Promise<void> {
  const tierMatch = value.match(TIER_VALUE);
  if (!tierMatch) return;
  const tier = tierMatch[1] as Tier; // regex constrains members to TIERS

  const result = tierMatch[2]
    ? await modelSwitchService.remapTier(tier, tierMatch[2])
    : await modelSwitchService.switchTier(tier);
  if (!result.ok) {
    sessionManager.reportStatus({
      role: "error",
      content: `(Error: ${result.reason})`,
    });
  }
}
