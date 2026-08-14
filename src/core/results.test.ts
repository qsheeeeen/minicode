import { describe, it, expect } from "vitest";
import {
  TurnFaultError,
  describeFault,
  isAbortError,
  isTurnFaultError,
} from "./results.js";

describe("TurnFaultError", () => {
  it("carries the fault and renders it as the message", () => {
    const err = new TurnFaultError({
      kind: "llm",
      reason: "rate limited",
      retryable: true,
    });
    expect(err.message).toBe("LLM error (retryable): rate limited");
    expect(isTurnFaultError(err)).toBe(true);
    expect(err.fault).toEqual({
      kind: "llm",
      reason: "rate limited",
      retryable: true,
    });
  });

  it("is recognizable across unknown values", () => {
    expect(isTurnFaultError(new Error("no"))).toBe(false);
    expect(isTurnFaultError(undefined)).toBe(false);
    expect(isTurnFaultError("string")).toBe(false);
  });
});

describe("describeFault", () => {
  it("marks non-retryable llm faults plainly", () => {
    expect(
      describeFault({ kind: "llm", reason: "bad key", retryable: false }),
    ).toBe("LLM error: bad key");
  });

  it("describes fatal faults", () => {
    expect(describeFault({ kind: "fatal", reason: "disk gone" })).toBe(
      "Fatal: disk gone",
    );
  });
});

describe("isAbortError", () => {
  it("matches AbortError by name", () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("rejects other errors and non-errors", () => {
    expect(isAbortError(new Error("no"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
