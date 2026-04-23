import { describe, it, expect } from 'vitest';
import React from 'react';
import { elementToText } from './react.js';

describe('elementToText', () => {
  it('returns empty string for null', () => {
    expect(elementToText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(elementToText(undefined)).toBe('');
  });

  it('returns string as-is', () => {
    expect(elementToText('hello world')).toBe('hello world');
  });

  it('converts number to string', () => {
    expect(elementToText(42)).toBe('42');
  });

  it('joins array elements with newlines', () => {
    expect(elementToText(['a', 'b', 'c'])).toBe('a\nb\nc');
  });

  it('filters empty strings from array', () => {
    expect(elementToText(['a', '', 'b'])).toBe('a\nb');
  });

  it('extracts text from React element children', () => {
    const element = React.createElement('div', { children: 'hello' });
    expect(elementToText(element)).toBe('hello');
  });

  it('recursively extracts nested children', () => {
    const element = React.createElement('div', {
      children: [
        'prefix',
        React.createElement('span', { children: 'inner' }),
        'suffix',
      ],
    });
    expect(elementToText(element)).toBe('prefix\ninner\nsuffix');
  });

  it('returns empty string for invalid React element', () => {
    // React.isValidElement returns false for plain objects
    expect(elementToText({ type: 'div' } as any)).toBe('');
  });
});
