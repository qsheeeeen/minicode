import type { LLMClient } from "../llm/client.js";
import type { Model } from "../llm/model.js";
import type pino from "pino";

/**
 * Sole owner of the process-wide mutable runtime handles (client, model,
 * logger). The composition root creates one instance, AgentDeps exposes
 * read-only getters over it, and services that must swap these handles
 * (model switch, session switch) go through this object instead of writing
 * into a shared deps bag. Consumers resolve the handles through getters at
 * use time — there is no change event to subscribe to.
 */
export class RuntimeState {
  constructor(
    private _client: LLMClient,
    private _model: Model,
    private _logger?: pino.Logger,
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
  }

  setLogger(logger: pino.Logger): void {
    this._logger = logger;
  }
}
