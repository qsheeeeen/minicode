import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { GlobalControls } from "./GlobalControls.js";

async function flushInput(): Promise<void> {
  // Ink waits briefly before classifying a bare Escape as a key rather than
  // the prefix of an escape sequence.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("GlobalControls", () => {
  it("aborts a running turn on Ctrl-C or Escape", async () => {
    const onAbort = vi.fn();
    const { stdin, unmount } = render(
      <GlobalControls
        isRunning
        onAbort={onAbort}
        onExit={vi.fn()}
        onCyclePermission={vi.fn()}
      />,
    );

    stdin.write("\u0003");
    await flushInput();
    stdin.write("\u001b");
    await flushInput();

    expect(onAbort).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("exits on Ctrl-C while idle, while Escape remains available to local inputs", async () => {
    const onExit = vi.fn();
    const { stdin, unmount } = render(
      <GlobalControls
        isRunning={false}
        onAbort={vi.fn()}
        onExit={onExit}
        onCyclePermission={vi.fn()}
      />,
    );

    stdin.write("\u0003");
    await flushInput();
    stdin.write("\u001b");
    await flushInput();

    expect(onExit).toHaveBeenCalledOnce();
    unmount();
  });

  it("cycles permission mode globally", async () => {
    const onCyclePermission = vi.fn();
    const { stdin, unmount } = render(
      <GlobalControls
        isRunning={false}
        onAbort={vi.fn()}
        onExit={vi.fn()}
        onCyclePermission={onCyclePermission}
      />,
    );

    stdin.write("\u001b[Z");
    await flushInput();

    expect(onCyclePermission).toHaveBeenCalledOnce();
    unmount();
  });
});
