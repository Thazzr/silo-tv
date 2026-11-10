/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles.css', 'utf-8');

/** The declarations of the rule that starts with exactly `selector {`. */
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

// The page scrolls with the focus (nav/adapter.ts reads `scroll-margin`), and the last rows would
// otherwise end below the 5 % safe area when focused.
describe('subtitle appearance page styles', () => {
  it.each(['.btn.subtitle-row', '.btn.subtitle-reset'])(
    'keeps %s above the bottom of the safe area when it scrolls into view',
    (selector) => {
      expect(rule(selector)).toContain('scroll-margin-bottom: var(--safe-y)');
    },
  );

  it('keeps every row at least as tall as a remote-control target', () => {
    expect(rule('.btn.subtitle-row')).toContain('min-height: var(--target)');
  });
});
