/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf-8');

// The overlay marks its focus with `data-focused` (PlayerOsd, Scrubber); these checks keep the
// stylesheet selecting exactly that, so a rename on either side cannot hide the focus again.
describe('player overlay focus styles', () => {
  it.each([
    ".player-btn[data-focused='true']",
    ".player-scrubber[data-focused='true'] .player-scrubber-track",
    ".player-scrubber[data-focused='true'] .player-scrubber-thumb",
  ])('styles %s', (selector) => {
    expect(css).toContain(selector);
  });

  it('shows the focused button as a white fill with a dark icon', () => {
    const rule = /\.player-btn\[data-focused='true'\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('background: var(--focus-fill)');
    expect(rule).toContain('color: var(--focus-content)');
  });

  it('keeps the overlay on a compositor layer and its gradient dark under the text', () => {
    const rule = /\.player-osd \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('will-change: opacity');
    expect(rule).toContain('min-height: 45vh');
    expect(rule).toMatch(/rgba\(0, 0, 0, 0\.8[5-9]|0\.9\d?\)/);
  });
});
