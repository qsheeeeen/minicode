import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";

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

    const projectHash = "testhash123";
    const sessionName = "test-session";

    await createLogger(projectHash, sessionName);

    const expectedLogDir = path.join(
      os.homedir(),
      ".minicode",
      "sessions",
      projectHash,
    );
    const expectedLogFile = path.join(expectedLogDir, `${sessionName}.log`);

    expect(fs.default.mkdir).toHaveBeenCalledWith(expectedLogDir, {
      recursive: true,
    });

    expect(pino.default.destination).toHaveBeenCalledWith({
      dest: expectedLogFile,
      sync: true,
    });

    expect(pino.default).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        base: { session: sessionName, projectHash },
      }),
      expect.any(Object),
    );
  });
});
