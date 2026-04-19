import React from 'react';

/** Extract plain text from a React element tree (Ink Text/Box) */
export function elementToText(el: React.ReactNode): string {
  if (el == null) return '';
  if (typeof el === 'string') return el;
  if (typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(elementToText).filter(Boolean).join('\n');
  if (React.isValidElement(el) && (el.props as any)?.children) {
    return elementToText((el.props as any).children as React.ReactNode);
  }
  return '';
}
