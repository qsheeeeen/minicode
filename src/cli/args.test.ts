import { describe, it, expect } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('returns defaults for empty args', () => {
    const result = parseArgs(['node', 'minicode']);
    expect(result).toEqual({
      modelOverride: undefined,
      initialPrompt: undefined,
      sessionName: undefined,
      resumeRecent: false,
      headless: false,
      permissionMode: undefined,
    });
  });

  it('parses --model', () => {
    const result = parseArgs(['node', 'minicode', '--model', 'glm-4.7@zhipu']);
    expect(result.modelOverride).toBe('glm-4.7@zhipu');
  });

  it('parses --session', () => {
    const result = parseArgs(['node', 'minicode', '--session', 'my-session']);
    expect(result.sessionName).toBe('my-session');
  });

  it('parses --resume', () => {
    const result = parseArgs(['node', 'minicode', '--resume']);
    expect(result.resumeRecent).toBe(true);
  });

  it('parses --headless', () => {
    const result = parseArgs(['node', 'minicode', '--headless']);
    expect(result.headless).toBe(true);
  });

  it('parses --permission manual', () => {
    const result = parseArgs(['node', 'minicode', '--permission', 'manual']);
    expect(result.permissionMode).toBe('manual');
  });

  it('parses --permission yolo', () => {
    const result = parseArgs(['node', 'minicode', '--perm', 'yolo']);
    expect(result.permissionMode).toBe('yolo');
  });

  it('parses --permission auto', () => {
    const result = parseArgs(['node', 'minicode', '--permission', 'auto']);
    expect(result.permissionMode).toBe('auto');
  });

  it('ignores invalid permission mode', () => {
    const result = parseArgs(['node', 'minicode', '--permission', 'invalid']);
    expect(result.permissionMode).toBeUndefined();
  });

  it('parses positional argument as initialPrompt', () => {
    const result = parseArgs(['node', 'minicode', 'list files']);
    expect(result.initialPrompt).toBe('list files');
  });

  it('parses prompt after flags', () => {
    const result = parseArgs(['node', 'minicode', '--headless', '--model', 'claude-3', 'fix the bug']);
    expect(result.initialPrompt).toBe('fix the bug');
    expect(result.headless).toBe(true);
    expect(result.modelOverride).toBe('claude-3');
  });

  it('ignores unknown flags', () => {
    // Unknown flags followed by a value get skipped along with their value
    // because they don't match any known flag
    const result = parseArgs(['node', 'minicode', '--unknown', 'value']);
    // --unknown isn't recognized, so 'value' becomes initialPrompt
    expect(result.initialPrompt).toBe('value');
  });
});
