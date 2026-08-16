// Shared helpers for protocol adapters. Vendor-specific knowledge stops here:
// an adapter may translate vendor errors into TurnFaults, but a raw vendor
// exception must never cross the LLMClient boundary.

import type { TurnFault } from "../../core/results.js";
import { isAbortError } from "../../core/results.js";
import type { LLMStreamResult } from "../client.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Fallback when the caller provides no model name. */
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

/** Classify a caught (non-abort) error from a provider SDK. */
export function faultFromError(e: unknown): TurnFault {
  const err = e as { status?: unknown; name?: unknown };
  const reason = e instanceof Error ? e.message : String(e);
  const name = typeof err.name === "string" ? err.name : "";

  if (typeof err.status === "number") {
    return {
      kind: "llm",
      reason: reason || `provider returned HTTP ${err.status}`,
      retryable: RETRYABLE_STATUS.has(err.status),
    };
  }
  if (
    /connection|timeout|fetch|network|econn|socket/i.test(`${name} ${reason}`)
  ) {
    return { kind: "llm", reason: reason || name, retryable: true };
  }
  return { kind: "fatal", reason: reason || name || "unknown provider error" };
}

/** Map a caught exception to the stream's terminal value: abort propagates
 *  (control flow), everything else becomes a fault value. The one form every
 *  adapter's catch block uses. */
export function terminalFromError(e: unknown): LLMStreamResult {
  if (isAbortError(e)) throw e;
  return { ok: false, fault: faultFromError(e) };
}
