/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const menus = readFileSync('src/styles/player-menus.css', 'utf-8');
const tokens = readFileSync('src/styles/tokens.css', 'utf-8');
const app = readFileSync('src/styles.css', 'utf-8');

/** The declarations of the rule that starts with exactly `selector {`. */
const rule = (css: string, selector: string) =>
  new RegExp(`${selector.replace(/[.[\]()]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

/** A CSS length expression (`calc(...)` of px numbers, `var(--x)` and 100vh), worked out. */
function evaluate(expression: string, vh: number): number {
  const declared = (name: string) => {
    const hit = new RegExp(`${name}:\\s*([^;]+);`).exec(menus + tokens);
    if (!hit) throw new Error(`no ${name}`);
    return hit[1]!.trim();
  };
  let text = expression;
  // Variables first (they may hold calc() of other variables).
  for (let i = 0; i < 10 && /var\(/.test(text); i += 1) {
    text = text.replace(/var\((--[a-z-]+)\)/g, (_m, name: string) => `(${declared(name)})`);
  }
  text = text.replace(/100vh/g, String(vh)).replace(/calc/g, '').replace(/px/g, '');
  // + - * / and parentheses over plain numbers.
  const tokensList = text.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let at = 0;
  const primary = (): number => {
    const token = tokensList[at++]!;
    if (token === '(') {
      const value = sum();
      at += 1;
      return value;
    }
    if (token === '-') return -primary();
    return Number(token);
  };
  const product = (): number => {
    let value = primary();
    while (tokensList[at] === '*' || tokensList[at] === '/') {
      const op = tokensList[at++];
      const right = primary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokensList[at] === '+' || tokensList[at] === '-') {
      const op = tokensList[at++];
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  return sum();
}

describe('the height of a player menu, worked out', () => {
  const cap = /max-height: ([^;]*);/.exec(rule(menus, '.player-menu'))?.[1] ?? '';

  it('keeps the gap at 16 px', () => {
    expect(menus).toMatch(/--player-menu-gap: 16px;/);
  });

  it('leaves 151.5 px under the popover: the safe margin, the part of the row the play disc is taller than a button, the button and the gap', () => {
    // 54 + (88 - 75) / 2 + 75 + 16
    expect(evaluate('var(--player-menu-below)', 1080)).toBe(151.5);
  });

  it.each([
    [1080, 874.5],
    [720, 514.5],
  ])('caps the menu at %i px high to %f px: the top safe margin to the popover', (vh, height) => {
    expect(evaluate(cap, vh)).toBe(height);
    // The menu's top then stands on the top safe margin (54 px).
    expect(vh - 151.5 - evaluate(cap, vh)).toBe(54);
  });
});

describe('the height of a player menu', () => {
  it('ends at the top safe margin and at the popover, not at a number copied from a button', () => {
    const cap = rule(menus, '.player-menu');
    expect(cap).toMatch(/max-height: calc\(100vh - var\(--safe-y\) - var\(--player-menu-below\)\)/);
    // The old cap carried the 88 px of the play disc as a literal.
    expect(cap).not.toContain('88px');
  });

  it("counts what is under the popover from the bar's real sizes", () => {
    const root = rule(menus, ':root');
    const below = /--player-menu-below:\s*calc\(([^;]*)\);/.exec(root)?.[1] ?? '';
    // The bottom safe margin, the part of the row the play disc is taller than a menu button, the
    // menu button itself and the gap to the popover.
    for (const part of [
      'var(--safe-y)',
      'var(--player-play)',
      'var(--target)',
      'var(--player-menu-gap)',
    ]) {
      expect(below).toContain(part);
    }
    // The popover stands that gap above its button.
    expect(rule(menus, '.player-popover')).toContain('bottom: calc(100% + var(--player-menu-gap))');
  });

  it('takes the play disc from the one token the bar uses', () => {
    expect(tokens).toMatch(/--player-play: 88px;/);
    const play = rule(app, '.player-btn-play');
    expect(play).toContain('width: var(--player-play)');
    expect(play).toContain('height: var(--player-play)');
  });

  it('scrolls a long list inside the menu', () => {
    expect(rule(menus, '.player-menu-scroll')).toContain('overflow-y: auto');
    expect(rule(menus, '.player-menu')).toContain('flex-direction: column');
  });

  it('is black at 90 % with a 12 px radius, and never blurs', () => {
    const box = rule(menus, '.player-menu');
    expect(box).toContain('background: rgba(0, 0, 0, 0.9)');
    expect(box).toContain('border-radius: 12px');
    expect(menus).not.toContain('backdrop-filter');
  });
});
