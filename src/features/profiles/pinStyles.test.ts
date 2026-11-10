/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf-8');

// The PIN view sat at the left edge while the picker before it is centred; these checks keep both
// on one centred axis.
describe('PIN entry layout', () => {
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[.[\]'=-]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('centres the PIN screen horizontally and vertically, like the picker', () => {
    expect(rule('.screen.picker')).toContain('text-align: center');
    const pin = rule('.screen.pin-screen');
    expect(pin).toContain('text-align: center');
    expect(pin).toContain('display: flex');
    expect(pin).toContain('flex-direction: column');
    expect(pin).toContain('align-items: center');
    expect(pin).toContain('justify-content: center');
    expect(pin).toContain('min-height: 100vh');
  });

  it('centres the entry block (prompt, dots, pad, messages)', () => {
    const entry = rule(".pin-screen [data-testid='pin-entry']");
    expect(entry).toContain('align-items: center');
  });

  it('keeps the pad keys at least 75 px', () => {
    expect(rule('.pad')).toContain('grid-template-columns: repeat(3, 120px)');
  });
});
