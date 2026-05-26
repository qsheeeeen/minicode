import React from "react";
import { Box, Text } from "ink";
import { ProgressBar } from "@inkjs/ui";
import { useTuiState } from "./store.js";
import type { Agent } from "../agent.js";

interface StatusBarProps {
  agentRef: React.MutableRefObject<Agent>;
}

export function StatusBar({ agentRef }: StatusBarProps) {
  const { tokenCount, permissionMode, currentSession, status, isLoading } =
    useTuiState();

  const contextLength = agentRef.current.getContextLength();
  const percentage = Math.min(100, (tokenCount / contextLength) * 100);

  const modeColor =
    permissionMode === "manual"
      ? "yellow"
      : permissionMode === "yolo"
        ? "red"
        : "cyan";

  return (
    <Box flexDirection="column">
      {/* Model / session info */}
      <Box paddingX={1}>
        <Text color="green">{agentRef.current.getModelProvider()}</Text>
        <Text dimColor>:</Text>
        <Text>{agentRef.current.getModelName()}</Text>
        <Text dimColor> | {currentSession}</Text>
        {status && !isLoading && <Text dimColor> | </Text>}
        {status && !isLoading && <Text color="magenta">{status}</Text>}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} gap={1}>
        <Text dimColor>
          {tokenCount.toLocaleString()}/{contextLength.toLocaleString()}
        </Text>
        <Box flexBasis={20}>
          <ProgressBar value={percentage} />
        </Box>
        <Text dimColor>{Math.floor(percentage)}%</Text>
        <Text dimColor> │ </Text>
        <Text color={modeColor}>{permissionMode}</Text>
        <Text dimColor> (Shift+Tab)</Text>
      </Box>
    </Box>
  );
}
