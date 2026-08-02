import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type pino from "pino";
import type { RuntimeEvents } from "./runtime-events.js";

/**
 * Sole owner of the process-wide mutable runtime handles (client, model,
 * logger). The composition root creates one instance, AgentDeps exposes
 * read-only getters over it, and services that must swap these handles
 * (model switch, session switch) go through this object instead of writing
 * into a shared deps bag.
 */
export class RuntimeState {
  constructor(
    private _client: LLMClient,
    private _model: Model,
    private _logger?: pino.Logger,
    private events?: RuntimeEvents,
  ) {}

  get client(): LLMClient {
    return this._client;
  }

  get model(): Model {
    return this._model;
  }

  get logger(): pino.Logger | undefined {
    return this._logger;
  }

  setClientModel(client: LLMClient, model: Model): void {
    this._client = client;
    this._model = model;
    // Single point of change: downstream services subscribe to model.changed
    // instead of being manually synced by each mutator.
    this.events?.emit({ type: "model.changed", client, model });
  }

  setLogger(logger: pino.Logger): void {
    this._logger = logger;
  }
}
