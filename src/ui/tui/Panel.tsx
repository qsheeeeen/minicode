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
  const { tokenCount, permissionMode, currentSession, status } =
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
    <Box flexDirection="column" overflow="hidden">
      <Box paddingX={1} overflow="hidden">
        <Text wrap="truncate" color="green">{agentRef.current.getModelProvider()}</Text>
        <Text wrap="truncate" dimColor>:</Text>
        <Text wrap="truncate">{agentRef.current.getModelName()}</Text>
        <Text wrap="truncate" dimColor> | {currentSession}</Text>
        {promptFiles.length > 0 && (
          <>
            <Text wrap="truncate" dimColor> | </Text>
            <Text wrap="truncate" dimColor>{promptFiles.join(", ")}</Text>
          </>
        )}
        {status && <Text wrap="truncate" dimColor> | </Text>}
        {status && <Text wrap="truncate" color="magenta">{status}</Text>}
      </Box>

      <Box paddingX={1} gap={1} overflow="hidden">
        <Text wrap="truncate" dimColor>
          {tokenCount.toLocaleString()}/{contextLength.toLocaleString()}
        </Text>
        <Box flexBasis={20}>
          <ProgressBar value={percentage} />
        </Box>
        <Text wrap="truncate" dimColor>{Math.floor(percentage)}% │ </Text>
        <Text wrap="truncate" color={modeColor}>{permissionMode}</Text>
      </Box>
    </Box>
  );
}
