import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./store.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Status() {
  const { isLoading } = useTuiState();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [isLoading]);

  if (!isLoading) return null;

  return (
    <Box paddingX={1}>
      <Text color="gray">{FRAMES[frame]} Thinking...</Text>
    </Box>
  );
}
