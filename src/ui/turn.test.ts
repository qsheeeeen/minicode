import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./turn.js";

const { mockRunAgent } = vi.hoisted(() => ({ mockRunAgent: vi.fn() }));

vi.mock("../agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent.js")>();
  return { ...actual, runAgent: mockRunAgent };
});

function makeOpts() {
  return {
    deps: {} as any,
    promptText: "hello",
    signal: new AbortController().signal,
    reportStatus: vi.fn(),
  };
}

describe("runAgentTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns completed on success", async () => {
    mockRunAgent.mockResolvedValueOnce(undefined);
    const opts = makeOpts();

    const outcome = await runAgentTurn(opts);

    expect(outcome).toBe("completed");
    expect(opts.reportStatus).not.toHaveBeenCalled();
  });

  it("converts AbortError to an (Aborted) status", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockRunAgent.mockRejectedValueOnce(abortErr);
    const opts = makeOpts();

    const outcome = await runAgentTurn(opts);

    expect(outcome).toBe("aborted");
    expect(opts.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "status", content: "(Aborted)" }),
    );
  });

  it("converts Errors to an error status", async () => {
    mockRunAgent.mockRejectedValueOnce(new Error("boom"));
    const opts = makeOpts();

    const outcome = await runAgentTurn(opts);

    expect(outcome).toBe("failed");
    expect(opts.reportStatus).toHaveBeenCalledWith(
      expect.objectContaining({ role: "error", content: "(Error: boom)" }),
    );
  });

  it("rethrows non-Error throwables", async () => {
    mockRunAgent.mockRejectedValueOnce("raw string");
    await expect(runAgentTurn(makeOpts())).rejects.toBe("raw string");
  });
});
