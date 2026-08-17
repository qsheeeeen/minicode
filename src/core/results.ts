// Failure doctrine for cross-boundary calls.
//
// Two failure classes, no third:
// - Step failures (a tool call failed, a command was rejected): returned as
//   values (ToolRunResult, status reasons) — the loop continues.
// - Turn failures (abort, fatal IO, unrecoverable LLM fault): carried by
//   TurnFaultError and caught exactly once at the turn boundary. Nothing
//   between the port and that boundary may swallow or rewrap them.

export type TurnFault =
  | { kind: "llm"; reason: string; retryable: boolean }
  | { kind: "fatal"; reason: string };

export function describeFault(fault: TurnFault): string {
  return fault.kind === "llm"
    ? `LLM error${fault.retryable ? " (retryable)" : ""}: ${fault.reason}`
    : `Fatal: ${fault.reason}`;
}

/** The typed exception for turn failures. Only the turn boundary catches it. */
export class TurnFaultError extends Error {
  constructor(readonly fault: TurnFault) {
    super(describeFault(fault));
    this.name = "TurnFaultError";
  }
}

export function isTurnFaultError(e: unknown): e is TurnFaultError {
  return e instanceof TurnFaultError;
}

/** True for the AbortError raised by signal.throwIfAborted(). */
export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name: unknown }).name === "AbortError"
  );
}

/** Construct the AbortError vocabulary `isAbortError` recognizes. */
export function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
