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

describe('scrub preview and chapter ticks styles', () => {
  /** The declarations of the rule that starts with exactly `selector {`. */
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('lets the pointer through the card, so hovering it cannot make it flicker', () => {
    expect(rule('.player-preview')).toContain('pointer-events: none');
  });

  it('moves the card by transform only, on its own layer', () => {
    const card = rule('.player-preview');
    expect(card).toContain('will-change: transform');
    expect(card).not.toMatch(/transition|backdrop-filter/);
  });

  it('rounds the card at 20 px and the thumbnail at 14 px, 24 px tabular time', () => {
    expect(rule('.player-preview')).toContain('border-radius: 20px');
    expect(rule('.player-preview-image')).toContain('border-radius: 14px');
    expect(rule('.player-preview-time')).toMatch(/font-size: 24px/);
    expect(rule('.player-preview-time')).toContain('tabular-nums');
  });

  it('draws chapter ticks 2 px wide, taller than the 6 px track', () => {
    const tick = rule('.player-scrubber-tick');
    expect(tick).toContain('width: 2px');
    expect(tick).toContain('rgba(255, 255, 255, 0.7)');
    expect(parseInt(/height: (\d+)px/.exec(tick)?.[1] ?? '0', 10)).toBeGreaterThan(6);
  });

  it('hides the heading with opacity only, and fills the card nearly opaque', () => {
    expect(css).toMatch(/\.player-osd-title\[data-covered='true'\][^{]*\{[^}]*opacity: 0/);
    expect(css).toMatch(/\.player-osd-series,\s*\.player-osd-title \{[^}]*transition: opacity/);
    expect(rule('.player-preview')).toMatch(/rgba\(21, 23, 28, 0\.9[5-9]\)/);
  });
});

describe('options panel styles', () => {
  const options = readFileSync('src/styles/options.css', 'utf-8');
  const tokens = readFileSync('src/styles/tokens.css', 'utf-8');
  const block = (selector: string) => {
    const start = options.indexOf(`${selector} {`);
    return start < 0 ? '' : options.slice(start, options.indexOf('}', start));
  };

  it('is flat: no blur, no backdrop filter, no shadow', () => {
    expect(options).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
  });

  it('is a solid column on the right edge, full height, inside the safe area', () => {
    const panel = block('.player-options');
    expect(panel).toContain('right: 0');
    expect(panel).toContain('top: 0');
    expect(panel).toContain('bottom: 0');
    expect(panel).toContain('var(--safe-y)');
    expect(panel).toContain('var(--safe-x)');
    expect(panel).toContain('background: var(--surface-raised)');
    expect(tokens).toMatch(/--surface-raised: #[0-9a-f]{6};/);
  });

  it('shows the focus of a row and of a tab as the white fill with a dark text', () => {
    for (const selector of ['.player-options-row:focus', '.player-options-tab:focus']) {
      expect(css + options).toContain(selector);
    }
    const row =
      /\.player-options-row:focus,\s*\.player-options-row:hover \{([^}]*)\}/.exec(options)?.[1] ??
      '';
    expect(row).toContain('background: var(--focus-fill)');
    expect(row).toContain('color: var(--focus-content)');
    expect(row).toContain('var(--focus-ring)');
    const tab =
      /\.player-options-tab:focus,\s*\.player-options-tab:hover \{([^}]*)\}/.exec(options)?.[1] ??
      '';
    expect(tab).toContain('background: var(--focus-fill)');
    expect(tab).toContain('transform: scale(');
  });

  it('is 760 px wide at the 1920 layout, and the loading cue centres in what it leaves free', () => {
    expect(options).toMatch(/:root \{\s*--options-width: 760px;\s*\}/);
    expect(block('.player-options')).toContain('width: var(--options-width)');
    const cue = block('.player-cue.player-cue-aside');
    expect(cue).toContain('left: calc((100% - var(--options-width)) / 2)');
  });

  it('keeps targets at least 75 px tall and text at least 20 px', () => {
    expect(tokens).toContain('--target: 75px');
    expect(block('.player-options-row')).toContain('min-height: var(--target)');
    expect(block('.player-options-tab')).toContain('height: var(--target)');
    expect(options).not.toMatch(/font-size: (1\d|[0-9])px/);
  });
});
