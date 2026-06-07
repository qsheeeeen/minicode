import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Receipt } from "./Receipt.js";
import type { ReceiptData } from "../../services/session-stats.js";

const mockData: ReceiptData = {
  projectName: "test-project",
  startTime: Date.now() - 60000,
  sessionCount: 2,
  sessionNames: ["session1", "session2"],
  models: [
    {
      name: "claude-sonnet",
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreation: 100,
      cacheRead: 200,
      total: 1800,
    },
  ],
  totalTokens: 1800,
};

describe("Receipt Component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders header and project name", () => {
    const { lastFrame } = render(
      <Receipt data={mockData} onDismiss={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("MINICODE SESSION RECEIPT");
    expect(output).toContain("test-project");
  });

  it("renders session count", () => {
    const { lastFrame } = render(
      <Receipt data={mockData} onDismiss={() => {}} />,
    );
    expect(lastFrame()).toContain("2");
  });

  it("renders model usage", () => {
    const { lastFrame } = render(
      <Receipt data={mockData} onDismiss={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("claude-sonnet");
    expect(output).toContain("1,000"); // input tokens
    expect(output).toContain("500"); // output tokens
  });

  it("renders cache stats when present", () => {
    const { lastFrame } = render(
      <Receipt data={mockData} onDismiss={() => {}} />,
    );
    const output = lastFrame();
    expect(output).toContain("Cache W");
    expect(output).toContain("Cache R");
  });

  it("hides cache stats when zero", () => {
    const data: ReceiptData = {
      ...mockData,
      models: [
        {
          name: "model",
          inputTokens: 100,
          outputTokens: 50,
          cacheCreation: 0,
          cacheRead: 0,
          total: 150,
        },
      ],
    };
    const { lastFrame } = render(<Receipt data={data} onDismiss={() => {}} />);
    const output = lastFrame();
    expect(output).not.toContain("Cache W");
    expect(output).not.toContain("Cache R");
  });

  it("renders total tokens", () => {
    const { lastFrame } = render(
      <Receipt data={mockData} onDismiss={() => {}} />,
    );
    expect(lastFrame()).toContain("1,800");
  });

  it("calls onDismiss via setTimeout", () => {
    const onDismiss = vi.fn();
    render(<Receipt data={mockData} onDismiss={onDismiss} />);
    vi.runAllTimers();
    expect(onDismiss).toHaveBeenCalled();
  });
});
