import React from 'react';
import { Box, Text } from 'ink';
import * as Diff from 'diff';

interface DiffLine {
  type: 'add' | 'remove' | 'header';
  content: string;
}

/** Generate compact summary diff: file stats + changed lines */
export function generateDiffSummary(filePath: string, oldText: string, newText: string): DiffLine[] {
  const changes = Diff.diffLines(oldText, newText);
  const result: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n');
    if (change.added) {
      added += lines.length;
      for (const line of lines) {
        result.push({ type: 'add', content: line });
      }
    } else if (change.removed) {
      removed += lines.length;
      for (const line of lines) {
        result.push({ type: 'remove', content: line });
      }
    }
  }

  // Prepend header with stats
  const header = `${filePath}: -${removed}/+${added} lines`;
  result.unshift({ type: 'header', content: header });

  return result;
}

/** Render diff lines as an ink Box */
export function renderDiffLines(lines: DiffLine[]): React.ReactElement {
  return React.createElement(
    Box,
    { marginBottom: 0, paddingX: 8, flexDirection: 'column' },
    ...lines.map((line, i) =>
      React.createElement(
        Text,
        {
          key: i,
          dimColor: true,
          color: line.type === 'add' ? 'green' : line.type === 'remove' ? 'red' : undefined,
        },
        line.content,
      ),
    ),
  );
}
