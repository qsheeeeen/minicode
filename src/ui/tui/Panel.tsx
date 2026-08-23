import React from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./state.js";
import type { Model } from "../../llm/model.js";

interface PanelProps {
  model: Model;
  promptFiles?: string[];
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  const thousands = tokens / 1000;
  return `${Number(thousands.toFixed(thousands < 10 ? 1 : 0))}k`;
}

export function Panel({ model, promptFiles = [] }: PanelProps) {
  const tokenCount = useTuiState((s) => s.tokenCount);
  const cacheHitRatio = useTuiState((s) => s.cacheHitRatio);
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
          {formatTokenCount(tokenCount)}/{formatTokenCount(contextLength)}
        </Text>
        <Text wrap="truncate" dimColor>
          {Math.floor(percentage)}% │{" "}
        </Text>
        {cacheHitRatio !== null && (
          <>
            <Text wrap="truncate" dimColor>
              cache{" "}
            </Text>
            <Text wrap="truncate" color="green">
              {Math.round(cacheHitRatio * 100)}%
            </Text>
            <Text wrap="truncate" dimColor>
              {" │ "}
            </Text>
          </>
        )}
        <Text wrap="truncate" color={modeColor}>
          {permissionMode}
        </Text>
      </Box>
    </Box>
  );
}
