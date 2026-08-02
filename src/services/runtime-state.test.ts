import { describe, it, expect } from "vitest";
import { RuntimeState } from "./runtime-state.js";
import { Model } from "../llm/model.js";

const makeModel = (name: string) => new Model(name, "p", 200000);

describe("RuntimeState", () => {
  it("exposes initial handles", () => {
    const client = { id: "c1" } as any;
    const model = makeModel("a");
    const logger = { info: () => {} } as any;
    const state = new RuntimeState(client, model, logger);
    expect(state.client).toBe(client);
    expect(state.model).toBe(model);
    expect(state.logger).toBe(logger);
  });

  it("logger is optional", () => {
    const state = new RuntimeState({} as any, makeModel("a"));
    expect(state.logger).toBeUndefined();
  });

  it("setClientModel swaps both handles", () => {
    const state = new RuntimeState({ id: "c1" } as any, makeModel("a"));
    const c2 = { id: "c2" } as any;
    const m2 = makeModel("b");
    state.setClientModel(c2, m2);
    expect(state.client).toBe(c2);
    expect(state.model).toBe(m2);
  });

  it("setLogger swaps the logger", () => {
    const state = new RuntimeState({} as any, makeModel("a"));
    const logger = { info: () => {} } as any;
    state.setLogger(logger);
    expect(state.logger).toBe(logger);
  });
});
