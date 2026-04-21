import React from 'react';
import { Box, Text } from 'ink';
import * as Diff from 'diff';

interface DiffLine {
  type: 'context' | 'add' | 'remove' | 'header';
  lineNum: number;
  content: string;
}

const CONTEXT_LINES = 3;

/** Generate unified-style diff with context lines and line numbers */
export function generateDiffSummary(filePath: string, oldText: string, newText: string): DiffLine[] {
  const hunks = Diff.structuredPatch('', '', oldText, newText, '', '', { context: CONTEXT_LINES });
  const result: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const hunk of hunks.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.startsWith('\\')) {
        continue; // skip "\ No newline at end of file"
      }
      if (line.startsWith('-')) {
        removed++;
        result.push({ type: 'remove', lineNum: oldLine, content: line.slice(1) });
        oldLine++;
      } else if (line.startsWith('+')) {
        added++;
        result.push({ type: 'add', lineNum: newLine, content: line.slice(1) });
        newLine++;
      } else {
        result.push({ type: 'context', lineNum: newLine, content: line.slice(1) });
        oldLine++;
        newLine++;
      }
    }
  }

  const header = `${filePath}: -${removed}/+${added} lines`;
  result.unshift({ type: 'header', lineNum: 0, content: header });

  return result;
}

/** Render unified diff: context=plain, removed=red - dim, added=green + normal */
export function renderDiffLines(lines: DiffLine[]): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line, i) => {
      if (line.type === 'header') {
        return React.createElement(Text, { key: i, dimColor: true }, `  ${line.content}`);
      }
      const num = String(line.lineNum).padStart(4);
      if (line.type === 'context') {
        return React.createElement(Text, { key: i, dimColor: true }, `${num}   ${line.content}`);
      }
      if (line.type === 'remove') {
        return React.createElement(
          Box,
          { key: i },
          React.createElement(Text, { color: 'red' }, `${num} - `),
          React.createElement(Text, { dimColor: true }, line.content),
        );
      }
      return React.createElement(
        Box,
        { key: i },
        React.createElement(Text, { color: 'green' }, `${num} + `),
        React.createElement(Text, null, line.content),
      );
    }),
  );
}
