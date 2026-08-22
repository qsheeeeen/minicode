// Shared helpers for protocol adapters. Vendor-specific knowledge stops here:
// an adapter may translate vendor errors into TurnFaults, but a raw vendor
// exception must never cross the LLMClient boundary.

import type { TurnFault } from "../../core/results.js";
import { isAbortError } from "../../core/results.js";
import type { EffortLevel, LLMStreamResult } from "../client.js";
import type { LLMImage } from "../../core/blocks.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Fallback when the caller provides no model name. */
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

/** Fallback when the caller provides no output-token budget. */
export const DEFAULT_MAX_TOKENS = 8192;

/** Map our effort ladder to OpenAI's `reasoning_effort` vocabulary (the
 *  Responses API caps at xhigh). */
export function toOpenAiEffort(
  effort: EffortLevel,
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  switch (effort) {
    case "none":
      return "none";
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
    case "max":
      return "xhigh";
  }
}

/** Parse streamed tool-call arguments. Truncated or invalid JSON keeps the
 *  raw string under `_raw` rather than silently dropping it. */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { _raw: raw };
  }
}

/** Encode an image as the data URL OpenAI endpoints accept. */
export function toDataUrl(image: LLMImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

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
