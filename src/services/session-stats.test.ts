import { describe, it, expect } from "vitest";
import { SessionStats } from "./session-stats.js";
import type { TokenUsage } from "../llm/client.js";

function usage(
  input: number,
  output: number,
  cacheMiss = 0,
  cacheHit = 0,
): TokenUsage {
  return {
    input: { total: input, cache_miss: cacheMiss, cache_hit: cacheHit },
    output,
  };
}

describe("SessionStats", () => {
  it("accumulates token usage across calls", () => {
    const stats = new SessionStats();
    stats.init(1000, "test-project", "session-1");

    stats.recordUsage("model-a", usage(100, 50, 10, 20));
    stats.recordUsage("model-a", usage(200, 80, 0, 30));

    const data = stats.getStats();
    expect(data.models).toHaveLength(1);
    expect(data.models[0].name).toBe("model-a");
    expect(data.models[0].input).toBe(300);
    expect(data.models[0].output).toBe(130);
    expect(data.models[0].cacheMiss).toBe(10);
    expect(data.models[0].cacheHit).toBe(50);
    expect(data.models[0].total).toBe(430);
    expect(data.totalTokens).toBe(430);
  });

  it("tracks usage per model separately", () => {
    const stats = new SessionStats();
    stats.init(1000, "test", "s1");

    stats.recordUsage("model-a", usage(100, 50));
    stats.recordUsage("model-b", usage(200, 80));
    stats.recordUsage("model-a", usage(50, 25));

    const data = stats.getStats();
    expect(data.models).toHaveLength(2);
    expect(data.models[0].name).toBe("model-a");
    expect(data.models[0].input).toBe(150);
    expect(data.models[1].name).toBe("model-b");
    expect(data.models[1].input).toBe(200);
    expect(data.totalTokens).toBe(150 + 75 + 200 + 80);
  });

  it("tracks session count", () => {
    const stats = new SessionStats();
    stats.init(1000, "test", "s1");

    expect(stats.getStats().sessionCount).toBe(1);

    stats.incrementSessionCount("s2");
    stats.incrementSessionCount("s3");

    expect(stats.getStats().sessionCount).toBe(3);
    expect(stats.getStats().sessionNames).toEqual(["s1", "s2", "s3"]);
  });

  it("records project name and start time", () => {
    const stats = new SessionStats();
    stats.init(42, "my-app", "initial");

    const data = stats.getStats();
    expect(data.projectName).toBe("my-app");
    expect(data.startTime).toBe(42);
  });

  it("returns empty models when no usage recorded", () => {
    const stats = new SessionStats();
    stats.init(0, "test", "s1");

    const data = stats.getStats();
    expect(data.models).toHaveLength(0);
    expect(data.totalTokens).toBe(0);
  });

  it("preserves model insertion order", () => {
    const stats = new SessionStats();
    stats.init(0, "test", "s1");

    stats.recordUsage("z-model", usage(1, 0));
    stats.recordUsage("a-model", usage(1, 0));
    stats.recordUsage("m-model", usage(1, 0));

    const data = stats.getStats();
    expect(data.models.map((m) => m.name)).toEqual([
      "z-model",
      "a-model",
      "m-model",
    ]);
  });
});
