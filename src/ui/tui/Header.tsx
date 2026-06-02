import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps) {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text bold color="cyan">minicode</Text>
      <Text dimColor> v{version}</Text>
    </Box>
  );
}
