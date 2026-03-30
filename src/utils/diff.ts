import * as Diff from 'diff';

export interface DiffLine {
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

/** Render compact diff summary as plain text (for non-ink contexts) */
export function renderDiffText(filePath: string, oldText: string, newText: string): string {
  const lines = generateDiffSummary(filePath, oldText, newText);
  return lines.map(l => {
    if (l.type === 'add') return `  + ${l.content}`;
    if (l.type === 'remove') return `  - ${l.content}`;
    return l.content;
  }).join('\n');
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
