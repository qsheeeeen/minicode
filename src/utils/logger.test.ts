import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

// Mock dependencies before importing the module to be tested
vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("pino", () => {
  const pinoMock = vi.fn().mockReturnValue({});
  (pinoMock as any).destination = vi.fn().mockReturnValue({});
  (pinoMock as any).stdTimeFunctions = {
    isoTime: () => "2024-01-01T00:00:00.000Z",
  };
  return { default: pinoMock };
});

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates directory and initializes pino with correct path", async () => {
    const fs = await import("fs/promises");
    const pino = await import("pino");

    const logDir = "/tmp/minicode-logger-test/sessions/abc123";
    const sessionName = "test-session";

    await createLogger(logDir, sessionName);

    expect(fs.default.mkdir).toHaveBeenCalledWith(logDir, {
      recursive: true,
    });

    expect(pino.default.destination).toHaveBeenCalledWith({
      dest: path.join(logDir, `${sessionName}.log`),
      sync: true,
    });

    expect(pino.default).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        base: { session: sessionName },
      }),
      expect.any(Object),
    );
  });
});
