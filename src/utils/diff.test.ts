import { describe, it, expect } from 'vitest';
import { generateDiffSummary } from './diff.js';

describe('generateDiffSummary', () => {
  it('returns header with file path and stats', () => {
    const result = generateDiffSummary('test.txt', 'hello', 'hello');
    expect(result[0].type).toBe('header');
    expect(result[0].content).toContain('test.txt');
  });

  it('returns header with 0/0 for identical text', () => {
    const result = generateDiffSummary('test.txt', 'hello', 'hello');
    expect(result[0].content).toBe('test.txt: -0/+0 lines');
  });

  it('detects added lines', () => {
    const result = generateDiffSummary('test.txt', '', 'new line');
    const added = result.filter(l => l.type === 'add');
    expect(added.length).toBeGreaterThan(0);
  });

  it('detects removed lines', () => {
    const result = generateDiffSummary('test.txt', 'old line', '');
    const removed = result.filter(l => l.type === 'remove');
    expect(removed.length).toBeGreaterThan(0);
  });

  it('marks added lines with type add', () => {
    const result = generateDiffSummary('test.txt', 'a\nb', 'a\nb\nc');
    const added = result.filter(l => l.type === 'add');
    expect(added.some(l => l.content.includes('c'))).toBe(true);
  });

  it('marks removed lines with type remove', () => {
    const result = generateDiffSummary('test.txt', 'a\nb\nc', 'a\nb');
    const removed = result.filter(l => l.type === 'remove');
    expect(removed.some(l => l.content.includes('c'))).toBe(true);
  });

  it('skips "No newline at end of file" lines', () => {
    const result = generateDiffSummary('test.txt', 'a\n', 'a');
    // Should not crash
    expect(result).toBeDefined();
  });
});
