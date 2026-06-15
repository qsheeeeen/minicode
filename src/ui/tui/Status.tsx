import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./state.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Status() {
  const isLoading = useTuiState((s) => s.isLoading);
  const pendingPrompt = useTuiState((s) => s.pendingPrompt);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, [isLoading]);

  if (!isLoading) return null;

  const label = pendingPrompt ? "Waiting for user..." : "Thinking...";

  return (
    <Box paddingX={1}>
      <Text color="gray">
        {FRAMES[frame]} {label}
      </Text>
    </Box>
  );
}
