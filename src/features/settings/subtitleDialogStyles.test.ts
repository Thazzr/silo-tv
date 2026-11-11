/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/subtitle-dialog.css', 'utf-8');

/** The declarations of the rule that starts with exactly `selector {`. */
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('subtitle appearance dialog styles', () => {
  it('keeps every row and the reset button at least as tall as a remote-control target', () => {
    expect(rule('.subtitle-row')).toContain('min-height: var(--target)');
    expect(rule('.subtitle-reset')).toContain('min-height: var(--target)');
  });

  it('scrolls its rows inside the panel, which stays inside the screen margins', () => {
    expect(rule('.subtitle-dialog-body')).toContain('overflow-y: auto');
    expect(rule('.subtitle-dialog')).toContain('max-height: calc(100vh - 2 * var(--safe-y))');
  });

  it('dims the screen without blurring it (the TV animates nothing but transform and opacity)', () => {
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('filter:');
  });

  it('marks the selected chip white with black text, and the selected swatch larger and ringed', () => {
    const chip = rule(".subtitle-chip[aria-checked='true']");
    expect(chip).toContain('color: #000');
    expect(chip).toContain('background: #fff');
    const swatch = rule(".subtitle-swatch[aria-checked='true']");
    expect(swatch).toContain('transform: scale(1.1)');
    expect(swatch).toContain('0 0 0 3px rgba(255, 255, 255, 0.9)');
    expect(swatch).toContain('0 0 0 6px rgba(0, 0, 0, 0.6)');
  });

  it('shows the focused row with a bright frame and a lighter fill', () => {
    expect(rule('.subtitle-row:focus')).toContain('border-color: #fff');
    expect(rule('.subtitle-row:focus')).toContain('background: rgba(255, 255, 255, 0.12)');
  });

  it('shows the focused reset button as a white pill with black text (its only focus cue)', () => {
    expect(rule('.subtitle-reset:focus')).toContain('color: #000');
    expect(rule('.subtitle-reset:focus')).toContain('background: #fff');
  });

  it('draws the switch on as a white track with a black knob', () => {
    expect(rule(".subtitle-switch[data-on='true']")).toContain('background: #fff');
    expect(rule(".subtitle-switch[data-on='true']::after")).toContain('background: #000');
  });

  it('keeps a swatch a round 44 px disc', () => {
    expect(rule('.subtitle-swatch')).toContain('width: 44px');
    expect(rule('.subtitle-swatch')).toContain('height: 44px');
  });

  it('draws the panel opaque, so nothing of the screen behind it shows through', () => {
    expect(rule('.subtitle-dialog')).toContain('background: #111114;');
  });
});
