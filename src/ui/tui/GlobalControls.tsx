import { useInput } from "ink";

interface GlobalControlsProps {
  /** A turn is in flight, including LLM streaming and tool execution. */
  isRunning: boolean;
  onAbort: () => void;
  onExit: () => void;
  onCyclePermission: () => void;
}

/**
 * Root-level keyboard controls. This intentionally stays active regardless of
 * the focused input mode so cancellation is always available while a turn is
 * streaming, waiting for a prompt, or running a tool.
 */
export function GlobalControls({
  isRunning,
  onAbort,
  onExit,
  onCyclePermission,
}: GlobalControlsProps) {
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        if (isRunning) onAbort();
        else onExit();
        return;
      }

      if (key.escape && isRunning) {
        onAbort();
        return;
      }

      if (key.shift && key.tab) onCyclePermission();
    },
    { isActive: true },
  );

  return null;
}
