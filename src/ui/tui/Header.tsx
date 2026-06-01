import React from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./store.js";
import type { Agent } from "#src/agent.js";

interface HeaderProps {
  version: string;
  promptFiles: string[];
  agentRef: React.MutableRefObject<Agent>;
}

export function Header({ version, promptFiles }: HeaderProps) {
  const { agentSessions, activeAgentId } = useTuiState();

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Box flexGrow={1}>
          <Text bold color="cyan">
            Mini Code
          </Text>
          <Text dimColor> v{version}</Text>
          {promptFiles.length > 0 && (
            <>
              <Text dimColor> | </Text>
              <Text dimColor>{promptFiles.join(", ")}</Text>
            </>
          )}
        </Box>
        <Box>
          {agentSessions.length > 1 && (
            <Text bold color="cyan">
              [{activeAgentId === "1" ? "M" : activeAgentId}]
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
