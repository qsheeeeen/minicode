import React from "react";
import { Box, Text } from "ink";

function summary(input: Record<string, unknown>): string {
  return JSON.stringify(input);
}

function formatCall(
  name: string,
  input: Record<string, unknown>,
): React.ReactElement {
  const content = callContent(name, input);
  return React.createElement(Text, { color: "yellow" }, content);
}

export function callContent(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "Read": {
      const path = input.path as string;
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      const parts = [path];
      if (offset) parts.push(`offset: ${offset}`);
      if (limit) parts.push(`limit: ${limit}`);
      return `${name}(${parts.join(", ")})`;
    }
    case "Write": {
      const path = input.path as string;
      const content = input.content as string;
      const lines = content ? content.split("\n").length : 0;
      return `${name}(${path}, ${lines} lines)`;
    }
    case "Edit": {
      return `${name}(${input.path as string})`;
    }
    case "Bash": {
      return `${name}(${input.command as string})`;
    }
    case "SubAgent": {
      const task = input.task as string;
      const preview = task.length > 30 ? task.slice(0, 30) + "..." : task;
      return `${name}(${preview})`;
    }
    case "ActivateSkill": {
      return `${name}(${input.name as string})`;
    }
    case "AskUser": {
      return `${name}("${input.question as string}")`;
    }
    case "SetModel": {
      return `${name}(Tier ${input.tier as string})`;
    }
    default:
      return `${name}(${summary(input)})`;
  }
}

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
    case "ActivateSkill": {
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
