import React from "react";
import { Box, Text } from "ink";
import { ProgressBar } from "@inkjs/ui";
import { useTuiState } from "./store.js";
import type { Agent } from "../../agent.js";

interface PanelProps {
  agentRef: React.MutableRefObject<Agent>;
  promptFiles?: string[];
}

export function Panel({ agentRef, promptFiles = [] }: PanelProps) {
  const { tokenCount, permissionMode, currentSession, status, isLoading, pendingPrompt } =
    useTuiState();

  const contextLength = agentRef.current.getContextLength() || 200000;
  const percentage = Math.min(100, (tokenCount / contextLength) * 100);

  const modeColor =
    permissionMode === "manual"
      ? "yellow"
      : permissionMode === "yolo"
        ? "red"
        : "cyan";

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color="green">{agentRef.current.getModelProvider()}</Text>
        <Text dimColor>:</Text>
        <Text>{agentRef.current.getModelName()}</Text>
        <Text dimColor> | {currentSession}</Text>
        {promptFiles.length > 0 && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>{promptFiles.join(", ")}</Text>
          </>
        )}
        {status && !isLoading && <Text dimColor> | </Text>}
        {status && !isLoading && <Text color="magenta">{status}</Text>}
        {isLoading && !pendingPrompt && <Text dimColor> | </Text>}
        {isLoading && !pendingPrompt && <Text color="magenta">streaming</Text>}
        {isLoading && pendingPrompt && <Text dimColor> | </Text>}
        {isLoading && pendingPrompt && <Text color="yellow">waiting for user</Text>}
      </Box>

      <Box paddingX={1} gap={1}>
        <Text dimColor>
          {tokenCount.toLocaleString()}/{contextLength.toLocaleString()}
        </Text>
        <Box flexBasis={20}>
          <ProgressBar value={percentage} />
        </Box>
        <Text dimColor>{Math.floor(percentage)}% │ </Text>
        <Text color={modeColor}>{permissionMode}</Text>
      </Box>
    </Box>
  );
}
