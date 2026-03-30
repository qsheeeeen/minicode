import * as Diff from 'diff';

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
}

/** Generate structured diff lines from old and new text */
export function generateDiffLines(filePath: string, oldText: string, newText: string): DiffLine[] {
  const patch = Diff.createPatch(filePath, oldText, newText, '', '');
  const lines = patch.split('\n');
  const result: DiffLine[] = [];

  for (const line of lines) {
    // Skip the === header and --- +++ headers
    if (line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) {
      if (line.startsWith('---') || line.startsWith('+++')) {
        result.push({ type: 'header', content: line });
      }
      continue;
    }
    if (line.startsWith('@@')) {
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line });
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line });
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', content: line });
    }
    // Skip empty trailing line
  }

  return result;
}

/** Render diff lines as plain text with markers (for non-ink contexts) */
export function renderDiffText(filePath: string, oldText: string, newText: string): string {
  const lines = generateDiffLines(filePath, oldText, newText);
  return lines.map(l => l.content).join('\n');
}

/** Marker prefix for detecting diff-formatted results from edit tool */
export const EDIT_RESULT_PREFIX = '__DIFF__:';

/** Encode edit result for transport through tool execute -> formatResult pipeline */
export function encodeEditResult(path: string, oldText: string, newText: string): string {
  return EDIT_RESULT_PREFIX + JSON.stringify({ path, oldText, newText });
}

/** Try to parse an edit result string; returns null if not a diff result */
export function tryParseEditResult(result: string): { path: string; oldText: string; newText: string } | null {
  if (!result.startsWith(EDIT_RESULT_PREFIX)) return null;
  try {
    return JSON.parse(result.slice(EDIT_RESULT_PREFIX.length));
  } catch {
    return null;
  }
}
