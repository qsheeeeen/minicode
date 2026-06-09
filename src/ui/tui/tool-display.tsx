import React from "react";
import { Box, Text } from "ink";
import { callContent } from "../../utils/tool-format.js";

function formatCall(
  name: string,
  input: Record<string, unknown>,
): React.ReactElement {
  const content = callContent(name, input);
  return React.createElement(Text, { color: "yellow" }, content);
}

export { callContent };

function formatResult(name: string, output: string): React.ReactElement | null {
  switch (name) {
    case "Read": {
      const lines = output.split("\n");
      return React.createElement(
        Text,
        { dimColor: true },
        `Read ${lines.length} lines, ${output.length} chars`,
      );
    }
    case "Write": {
      return React.createElement(Text, { dimColor: true }, output);
    }
    case "Edit": {
      return renderDiff(output);
    }
    case "Bash": {
      return React.createElement(Text, { dimColor: true }, output);
    }
    case "SubAgent": {
      return React.createElement(Text, { dimColor: true }, output);
    }
    case "LoadSkill": {
      return React.createElement(Text, { dimColor: true }, "Loaded");
    }
    default:
      return React.createElement(Text, { dimColor: true }, output);
  }
}

function renderDiff(output: string): React.ReactElement {
  const lines = output.split("\n");
  if (lines.length <= 1) {
    return React.createElement(Text, { dimColor: true }, output);
  }

  const elements: React.ReactElement[] = [];
  elements.push(
    React.createElement(Text, { key: 0, dimColor: true }, lines[0]),
  );

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^\s*\d+\s+\+/)) {
      elements.push(
        React.createElement(Text, { key: i, color: "green" }, line),
      );
    } else if (line.match(/^\s*\d+\s+-/)) {
      elements.push(React.createElement(Text, { key: i, color: "red" }, line));
    } else {
      elements.push(
        React.createElement(Text, { key: i, dimColor: true }, line),
      );
    }
  }

  return React.createElement(Box, { flexDirection: "column" }, ...elements);
}

export function ToolDisplay({
  name,
  input,
  output,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}) {
  const callEl = formatCall(name, input);
  if (output === undefined) return callEl;
  const resultEl = formatResult(name, output);
  return resultEl
    ? React.createElement(Box, { flexDirection: "column" }, callEl, resultEl)
    : callEl;
}
