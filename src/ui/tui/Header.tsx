import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";

interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps) {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Gradient name="mind">
        <Text bold>MiniCode</Text>
      </Gradient>
      <Text dimColor> v{version}</Text>
    </Box>
  );
}
