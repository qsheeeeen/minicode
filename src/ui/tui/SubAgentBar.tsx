import React from "react";
import { Box, Text } from "ink";
import { useTuiState } from "./store.js";

export function SubAgentBar() {
  const { agentSessions, activeAgentId } = useTuiState();

  if (agentSessions.length <= 1) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      {agentSessions.map((session) => {
        const isActive = session.id === activeAgentId;
        const statusIcon =
          session.status === "running"
            ? "⟳"
            : session.status === "completed"
              ? "✓"
              : session.status === "error"
                ? "✕"
                : "●";

        const task = session.task
          ? session.task.length > 40
            ? session.task.slice(0, 40) + "..."
            : session.task
          : session.type === "main"
            ? "Main agent"
            : "";

        const stats: string[] = [];
        if (session.tokenCount)
          stats.push(`${session.tokenCount.toLocaleString()} tok`);
        if (session.toolCalls) stats.push(`${session.toolCalls} tools`);
        const statsStr = stats.length > 0 ? ` | ${stats.join(", ")}` : "";

        return (
          <Text key={session.id} inverse={isActive} bold={isActive}>
            {isActive ? "▸" : " "} [{session.id}] {statusIcon} {task}
            {statsStr}
          </Text>
        );
      })}
    </Box>
  );
}
