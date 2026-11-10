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

  it('rounds the card slightly, with the thumbnail flush at the top: no padding, a thin light line', () => {
    const card = rule('.player-preview');
    expect(card).toContain('border-radius: 10px');
    expect(card).toContain('overflow: hidden');
    expect(card).not.toMatch(/padding/);
    const image = rule('.player-preview-image');
    // An inset outline: it draws the border without changing the 256 px the sprite is scaled to.
    expect(image).toContain('outline: 1px solid rgba(255, 255, 255, 0.35)');
    expect(image).toContain('outline-offset: -1px');
    expect(image).not.toMatch(/padding|margin/);
  });

  it('makes the time a slim strip: 22 px tabular time left, the rate right', () => {
    const strip = rule('.player-preview-time');
    expect(strip).toContain('font-size: 22px');
    expect(strip).toContain('tabular-nums');
    expect(strip).toContain('display: flex');
    expect(strip).toContain('justify-content: space-between');
    expect(strip).toContain('padding: 6px 12px');
    expect(css).not.toContain('player-preview-chapter');
  });

  it('keeps the card above the Info panel, which stands above the overlay gradient', () => {
    const zOf = (body: string) => Number(/z-index: (\d+)/.exec(body)?.[1]);
    const menus = readFileSync('src/styles/player-menus.css', 'utf-8');
    const info = menus.slice(
      menus.indexOf('.player-info {'),
      menus.indexOf('}', menus.indexOf('.player-info {')),
    );
    expect(zOf(info)).toBeGreaterThan(0);
    expect(zOf(rule('.player-preview'))).toBeGreaterThan(zOf(info));
    // The gradient is the overlay's own background, so a child of the overlay paints over it
    // without the overlay needing a z-index of its own.
    expect(rule('.player-osd')).toContain('linear-gradient');
    expect(rule('.player-osd')).not.toMatch(/z-index/);
  });

  it('draws chapter ticks 2 px wide, taller than the 6 px track', () => {
    const tick = rule('.player-scrubber-tick');
    expect(tick).toContain('width: 2px');
    expect(tick).toContain('rgba(255, 255, 255, 0.7)');
    expect(parseInt(/height: (\d+)px/.exec(tick)?.[1] ?? '0', 10)).toBeGreaterThan(6);
  });

  it('fills the strip dark and translucent, with no blur or shadow on the card', () => {
    const alpha = Number(
      /background: rgba\(21, 23, 28, (0\.\d+)\)/.exec(rule('.player-preview-time'))?.[1],
    );
    expect(alpha).toBeGreaterThanOrEqual(0.7);
    expect(alpha).toBeLessThanOrEqual(0.9);
    for (const selector of ['.player-preview', '.player-preview-image', '.player-preview-time']) {
      expect(rule(selector), selector).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
    }
  });
});

describe('overlay layout styles', () => {
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('puts Exit in the top-left, inside the safe area, on a soft gradient and no blur', () => {
    const top = rule('.player-osd-top');
    expect(top).toContain('padding: var(--safe-y) var(--safe-x)');
    expect(top).toContain('linear-gradient(to bottom');
    expect(top).toContain('top: 0');
    expect(top).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
    expect(top).toContain('will-change: opacity');
  });

  it('shows the focused Exit pill like the other buttons: white fill, dark content', () => {
    const focus = /\.player-exit\[data-focused='true'\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(focus).toContain('background: var(--focus-fill)');
    expect(focus).toContain('color: var(--focus-content)');
    expect(css).toMatch(/\.player-exit:hover/);
  });

  it('keeps Exit a pill at least 75 px tall with text of at least 20 px', () => {
    const exit = rule('.player-exit');
    expect(exit).toContain('height: var(--target)');
    expect(exit).toContain('border-radius: calc(var(--target) / 2)');
    expect(exit).toContain('font-size: var(--fs-tab)');
  });

  it('gives each segment kind its own colour on the scrubber, without a filter', () => {
    const colours = ['intro', 'recap', 'credits', 'preview'].map((kind) => {
      const body = rule(`.player-scrubber-band[data-kind='${kind}']`);
      expect(body, kind).toMatch(/background: rgba\(\d+, \d+, \d+, 0\.45\)/);
      expect(body, kind).not.toMatch(/backdrop-filter|filter:|blur\(/);
      return /background: (rgba\([^)]*\))/.exec(body)![1];
    });
    expect(new Set(colours).size).toBe(4);
    expect(colours).toEqual([
      'rgba(125, 211, 252, 0.45)',
      'rgba(196, 181, 253, 0.45)',
      'rgba(252, 211, 77, 0.45)',
      'rgba(110, 231, 183, 0.45)',
    ]);
    // The buffer is plain grey-white, apart from the bands.
    expect(rule('.player-scrubber-buffered')).toContain('rgba(255, 255, 255, 0.5)');
    expect(rule('.player-scrubber-band')).not.toMatch(/backdrop-filter|filter:|blur\(/);
  });

  it('marks a button whose menu is open with a ring and a wash, not the white fill', () => {
    const open = rule(".player-btn[data-open='true']");
    expect(open).toContain('border-color: var(--focus-ring)');
    expect(open).toContain('background: var(--chrome-selected)');
    expect(open).not.toContain('--focus-fill');
    // Before the focus rule, so a focused open button (Info) still shows the focus.
    expect(css.indexOf(".player-btn[data-open='true']")).toBeLessThan(
      css.indexOf(".player-btn[data-focused='true']"),
    );
  });

  it('lays the row out in three parts, so a long title never pushes the centre', () => {
    expect(rule('.player-osd-row')).toContain('grid-template-columns: 1fr auto 1fr');
    expect(rule('.player-osd-titles')).toContain('min-width: 0');
    const title = rule('.player-osd-title');
    expect(title).toContain('text-overflow: ellipsis');
    expect(title).toContain('white-space: nowrap');
    // Only the detail shrinks, with an ellipsis; the time, with its dot, never does.
    expect(rule('.player-osd-meta')).toContain('display: flex');
    const detail = rule('.player-osd-detail');
    expect(detail).toContain('min-width: 0');
    expect(detail).toContain('overflow: hidden');
    expect(detail).toContain('text-overflow: ellipsis');
    const clock = rule('.player-osd-clock');
    expect(clock).toContain('flex-shrink: 0');
    expect(clock).not.toContain('overflow');
  });

  it('right-aligns the clock above the scrubber, 22 px, never shrinking, inside the safe area', () => {
    const clock = rule('.player-osd-clock');
    expect(clock).toContain('text-align: right');
    expect(clock).toContain('flex-shrink: 0');
    expect(clock).toContain('white-space: pre');
    expect(parseInt(/font-size: (\d+)px/.exec(clock)?.[1] ?? '0', 10)).toBeGreaterThanOrEqual(22);
    // The overlay's own padding keeps its content, the clock included, off the screen edge.
    expect(rule('.player-osd')).toContain('padding: 120px var(--safe-x) var(--safe-y)');
    // The title block's second line no longer carries it.
    expect(rule('.player-osd-meta')).not.toContain('tabular');
  });

  it('uses no backdrop filter, blur or shadow on the overlay, its buttons and Exit', () => {
    for (const selector of ['.player-osd', '.player-osd-top', '.player-btn', '.player-exit']) {
      expect(rule(selector), selector).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
    }
  });

  it('has no row of the old times and no heading cover', () => {
    expect(css).not.toContain('.player-osd-times');
    expect(css).not.toContain('data-covered');
    expect(css).not.toContain('player-cue-aside');
  });

  it('draws no text under 20 px in the overlay', () => {
    const sizes = [...css.matchAll(/\.player-(?:osd|exit|btn)[^{]*\{[^}]*font-size: (\d+)px/g)];
    for (const match of sizes) expect(Number(match[1])).toBeGreaterThanOrEqual(20);
  });
});

describe('player menu styles', () => {
  const menus = readFileSync('src/styles/player-menus.css', 'utf-8');
  const tokens = readFileSync('src/styles/tokens.css', 'utf-8');
  const block = (selector: string) => {
    const start = menus.indexOf(`${selector} {`);
    return start < 0 ? '' : menus.slice(start, menus.indexOf('}', start));
  };

  it('is flat: no blur, no backdrop filter, no shadow', () => {
    expect(menus).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
  });

  it('stands the popover above its button, right-aligned, with a solid rounded surface', () => {
    const popover = block('.player-popover');
    expect(popover).toContain('right: 0');
    expect(popover).toMatch(/bottom: calc\(100% \+ \d+px\)/);
    const box = block('.player-menu');
    expect(box).toContain('background: var(--surface-raised)');
    expect(box).toContain('border-radius: 20px');
    expect(tokens).toMatch(/--surface-raised: #[0-9a-f]{6};/);
  });

  it('keeps the popover inside the safe area: no wider than the screen less both margins, no taller than the room above the buttons', () => {
    const box = block('.player-menu');
    expect(box).toContain('max-width: calc(100vw - 2 * var(--safe-x))');
    // Top safe margin, bottom safe margin, the 88 px button row and the gap to it.
    expect(box).toContain('max-height: calc(100vh - 2 * var(--safe-y) - 88px - 16px)');
    // A longer list scrolls inside it.
    expect(block('.player-menu-scroll')).toContain('overflow-y: auto');
  });

  it('shows the focus of a row as the white fill with dark text and a ring', () => {
    const row =
      /\.player-menu-row:focus,\s*\.player-menu-row:hover \{([^}]*)\}/.exec(menus)?.[1] ?? '';
    expect(row).toContain('background: var(--focus-fill)');
    expect(row).toContain('color: var(--focus-content)');
    expect(row).toContain('var(--focus-ring)');
  });

  it('keeps rows at least 75 px tall and text at least 20 px', () => {
    expect(tokens).toContain('--target: 75px');
    expect(block('.player-menu-row')).toContain('min-height: var(--target)');
    expect(menus).not.toMatch(/font-size: (1\d|[0-9])px/);
    expect(block('.player-menu-heading')).toContain('font-size: var(--fs-small)');
    expect(tokens).toContain('--fs-small: 20px');
  });

  it('fills the focused row of the playing chapter with the focus fill, like any focused row', () => {
    const rule =
      /\.player-menu-row\[data-current='true'\]:focus,\s*\.player-menu-row\[data-current='true'\]:hover \{([^}]*)\}/.exec(
        menus,
      )?.[1] ?? '';
    expect(rule).toContain('background: var(--focus-fill)');
  });

  it('sets the headings in small letter-spaced capitals', () => {
    const heading = block('.player-menu-heading');
    expect(heading).toContain('text-transform: uppercase');
    expect(heading).toContain('letter-spacing');
  });

  it('puts the Info panel on the left inside the safe area, below Exit, solid and flat', () => {
    const panel = block('.player-info');
    expect(panel).toContain('left: var(--safe-x)');
    expect(panel).toContain('top: calc(var(--safe-y) + var(--target)');
    // A little see-through, so it sits on the picture; no blur or filter for it.
    const alpha = Number(/background: rgba\(21, 23, 28, (0\.\d+)\)/.exec(panel)?.[1]);
    expect(alpha).toBeGreaterThanOrEqual(0.7);
    expect(alpha).toBeLessThanOrEqual(0.9);
    // Fixed, so it is placed against the screen although it is a child of the overlay.
    expect(panel).toContain('position: fixed');
    expect(panel).not.toMatch(/backdrop-filter|filter:|blur\(|box-shadow/);
  });

  it('makes the Info panel about 1100 px wide with two columns, as tall as its content', () => {
    const panel = block('.player-info');
    expect(panel).toContain('width: 1100px');
    expect(panel).toContain('display: grid');
    expect(panel).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    // It stays inside the safe area on a narrower screen and above the scrubber and the buttons.
    expect(panel).toContain('max-width: calc(100vw - 2 * var(--safe-x))');
    expect(panel).toContain('max-height: calc(100vh - 2 * var(--safe-y)');
    // No fixed height or bottom: it takes its content's height.
    expect(panel).not.toMatch(/(^|[\s;])(height|bottom):/);
  });

  it('lays the Info footer in the right column (no spanning) and lets its long text wrap', () => {
    const footer = block('.player-info-footer');
    expect(footer).not.toContain('grid-column');
    expect(footer).toContain('border-top');
    const text = block('.player-info-footer .player-info-fact dd');
    expect(text).toContain('white-space: normal');
    expect(text).not.toContain('nowrap');
  });

  it('keeps the Info rows compact: 30 px rows, 22 px text, nothing under 20 px', () => {
    expect(block('.player-info-fact')).toContain('min-height: 30px');
    expect(block('.player-info-fact')).toContain('font-size: 22px');
    const sizes = [...menus.slice(menus.indexOf('.player-info {')).matchAll(/font-size: (\d+)px/g)];
    expect(sizes.length).toBeGreaterThan(0);
    for (const match of sizes) expect(Number(match[1])).toBeGreaterThanOrEqual(20);
    expect(block('.player-info .player-menu-heading')).not.toMatch(/font-size/);
    expect(block('.player-menu-heading')).toContain('font-size: var(--fs-small)');
  });

  it('no longer carries the options panel', () => {
    expect(menus).not.toContain('player-options');
    expect(menus).not.toContain('--options-width');
  });
});
