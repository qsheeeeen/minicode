import React from "react";
import { Box, Text } from "ink";

export function Help() {
  return (
    <Box paddingX={1}>
      <Text dimColor>enter send │ ctrl+c abort/quit │ esc abort │ shift+tab cycle mode</Text>
    </Box>
  );
}
