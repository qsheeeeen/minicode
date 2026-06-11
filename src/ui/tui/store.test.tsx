import { describe, it, expect } from "vitest";
import {
  tuiReducer,
  initialState,
  type TuiState,
  type TuiAction,
} from "./store.js";

describe("tuiReducer", () => {
  it("should update input value correctly and return new state", () => {
    const action: TuiAction = { type: "SET_INPUT_VALUE", payload: "new value" };
    const nextState = tuiReducer(initialState, action);

    expect(nextState.input.value).toBe("new value");
    expect(nextState).not.toBe(initialState);
  });

  it("should return exact same state instance if input value does not change (bailout)", () => {
    const state: TuiState = {
      ...initialState,
      input: { ...initialState.input, value: "same value" },
    };
    const action: TuiAction = {
      type: "SET_INPUT_VALUE",
      payload: "same value",
    };
    const nextState = tuiReducer(state, action);

    expect(nextState).toBe(state);
  });

  it("should correctly set input mode and update props", () => {
    const action: TuiAction = {
      type: "SET_INPUT_MODE",
      payload: { mode: "effort-select", props: { foo: "bar" } },
    };
    const nextState = tuiReducer(initialState, action);

    expect(nextState.input.mode).toBe("effort-select");
    expect(nextState.input.props).toEqual({ foo: "bar" });
  });

  it("should correctly set token count and bail out if same", () => {
    const action: TuiAction = { type: "SET_TOKEN_COUNT", payload: 1234 };
    const state1 = tuiReducer(initialState, action);
    expect(state1.tokenCount).toBe(1234);

    const state2 = tuiReducer(state1, action);
    expect(state2).toBe(state1);
  });

  describe("SET_MESSAGES", () => {
    it("should replace messages with payload", () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "text" as const, content: "Hi there!" },
      ];
      const action: TuiAction = { type: "SET_MESSAGES", payload: messages };
      const nextState = tuiReducer(initialState, action);

      expect(nextState.messages).toBe(messages);
      expect(nextState.messages).toHaveLength(2);
      expect(nextState.messages[0].role).toBe("user");
      expect(nextState.messages[1].role).toBe("text");
    });

    it("should handle empty messages array", () => {
      const action: TuiAction = { type: "SET_MESSAGES", payload: [] };
      const nextState = tuiReducer(initialState, action);

      expect(nextState.messages).toEqual([]);
    });

    it("should replace previous messages on each dispatch", () => {
      const msgs1 = [{ role: "user" as const, content: "First" }];
      const msgs2 = [
        { role: "user" as const, content: "Second" },
        { role: "text" as const, content: "Reply" },
      ];

      const state1 = tuiReducer(initialState, {
        type: "SET_MESSAGES",
        payload: msgs1,
      });
      expect(state1.messages).toBe(msgs1);

      const state2 = tuiReducer(state1, {
        type: "SET_MESSAGES",
        payload: msgs2,
      });
      expect(state2.messages).toBe(msgs2);
      expect(state2.messages).not.toBe(msgs1);
    });
  });
});
