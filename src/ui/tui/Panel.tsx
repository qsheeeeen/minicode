import React from "react";
import { Box, Text } from "ink";
import { ProgressBar } from "@inkjs/ui";
import { useTuiState } from "./state.js";
import type { Model } from "../../llm/model.js";

interface PanelProps {
  model: Model;
  promptFiles?: string[];
}

export function Panel({ model, promptFiles = [] }: PanelProps) {
  const tokenCount = useTuiState((s) => s.tokenCount);
  const permissionMode = useTuiState((s) => s.permissionMode);
  const currentSession = useTuiState((s) => s.currentSession);

  const currentModel = model;
  const contextLength = currentModel.getContextLength();
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
        <Text wrap="truncate" color="green">
          {currentModel.getProvider()}
        </Text>
        <Text wrap="truncate" dimColor>
          :
        </Text>
        <Text wrap="truncate">{currentModel.getDisplayName()}</Text>
        <Text wrap="truncate" dimColor>
          {" "}
          | {currentSession}
        </Text>
        {promptFiles.length > 0 && (
          <>
            <Text wrap="truncate" dimColor>
              {" "}
              |{" "}
            </Text>
            <Text wrap="truncate" dimColor>
              {promptFiles.join(", ")}
            </Text>
          </>
        )}
      </Box>

      <Box paddingX={1} gap={1} overflow="hidden">
        <Text wrap="truncate" dimColor>
          {tokenCount.toLocaleString()}/{contextLength.toLocaleString()}
        </Text>
        <Box flexBasis={20}>
          <ProgressBar value={percentage} />
        </Box>
        <Text wrap="truncate" dimColor>
          {Math.floor(percentage)}% │{" "}
        </Text>
        <Text wrap="truncate" color={modeColor}>
          {permissionMode}
        </Text>
      </Box>
    </Box>
  );
}
