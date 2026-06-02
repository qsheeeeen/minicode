import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";

interface HeaderProps {
  version: string;
  projectPath: string;
}

export function Header({ version, projectPath }: HeaderProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop={true}
      borderBottom={true}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginBottom={1}
    >
      <Box>
        <Gradient name="mind">
          <Text bold>MiniCode</Text>
        </Gradient>
        <Text dimColor> (v{version})</Text>
      </Box>
      <Text dimColor>directory: {projectPath}</Text>
    </Box>
  );
}
