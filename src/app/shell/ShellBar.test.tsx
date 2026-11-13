import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BarAwayStore, ShellBarContext, useBarAway, useContentAway } from './ShellBar';
import { BAR_HEIGHT } from './tabs';

function Part({ away }: { away: boolean }) {
  useBarAway(away);
  return null;
}

/** What the top bar sees of the store. */
function Bar() {
  return <p data-testid="bar">{useContentAway() ? 'away' : 'shown'}</p>;
}

function shell(store: BarAwayStore, away: boolean, part = true) {
  return (
    <ShellBarContext.Provider value={store}>
      <Bar />
      {part ? <Part away={away} /> : null}
    </ShellBarContext.Provider>
  );
}

describe('useBarAway', () => {
  it('turns the bar away while the content reports that it is away, and back when it is at the top', () => {
    const store = new BarAwayStore();
    const view = render(shell(store, false));
    expect(screen.getByTestId('bar')).toHaveTextContent('shown');
    view.rerender(shell(store, true));
    expect(screen.getByTestId('bar')).toHaveTextContent('away');
    view.rerender(shell(store, false));
    expect(screen.getByTestId('bar')).toHaveTextContent('shown');
  });

  it('keeps the bar away while any part is away', () => {
    const store = new BarAwayStore();
    const first = {};
    const second = {};
    render(shell(store, false));
    act(() => {
      store.report(first, true);
      store.report(second, true);
    });
    expect(screen.getByTestId('bar')).toHaveTextContent('away');
    act(() => store.report(first, false));
    expect(screen.getByTestId('bar')).toHaveTextContent('away');
    act(() => store.report(second, false));
    expect(screen.getByTestId('bar')).toHaveTextContent('shown');
  });

  it('counts a part that goes away as back at the top', () => {
    const store = new BarAwayStore();
    const view = render(shell(store, true));
    expect(screen.getByTestId('bar')).toHaveTextContent('away');
    view.rerender(shell(store, true, false));
    expect(screen.getByTestId('bar')).toHaveTextContent('shown');
  });

  it('tells a listener only when the bar has to change', () => {
    const store = new BarAwayStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const first = {};
    store.report(first, true);
    store.report({}, true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.report(first, false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does no harm outside the shell', () => {
    expect(() => render(<Part away />)).not.toThrow();
  });
});

describe('the size of the top bar', () => {
  it('is what the stylesheet gives --bar-h, which the navigation leaves out of the content group', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf-8');
    const px = (name: string) => Number(new RegExp(`${name}: (\\d+)px`).exec(tokens)?.[1]);
    expect(tokens).toContain('--bar-h: calc(var(--safe-y) + var(--target) + 12px)');
    expect(BAR_HEIGHT).toBe(px('--safe-y') + px('--target') + 12);
  });
});

describe('the gradient behind the top bar', () => {
  // The text of the tabs (26 px, centred at y 91.5) and of the server name (y 77.5 to 105.5) lies
  // between these two lines; the web's rule is 4.5:1 for secondary text over a white picture,
  // which white text needs black at 0.533 or more over.
  const TEXT_TOP = 75;
  const TEXT_BOTTOM = 108;
  const MIN_ALPHA = 0.54;

  /** The black alpha of the stylesheet's gradient at `y`, interpolated between its stops. */
  function alphaAt(y: number): number {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');
    const rule = /\.topbar::before \{[^}]*\}/.exec(css)![0];
    const height = Number(/height: (\d+)px/.exec(rule)![1]);
    const stops = [...rule.matchAll(/rgba\(0, 0, 0, ([\d.]+)\) (0|\d+px|100%)/g)].map((m) => ({
      at: m[2] === '100%' ? height : Number.parseInt(m[2]!, 10),
      alpha: Number(m[1]),
    }));
    const after = stops.findIndex((stop) => stop.at >= y);
    const from = stops[after - 1]!;
    const to = stops[after]!;
    return from.alpha + ((to.alpha - from.alpha) * (y - from.at)) / (to.at - from.at);
  }

  it('keeps the black at 0.54 or more over the whole text of the tabs and the server name', () => {
    expect(alphaAt(TEXT_TOP)).toBeGreaterThanOrEqual(MIN_ALPHA);
    expect(alphaAt(TEXT_BOTTOM)).toBeGreaterThanOrEqual(MIN_ALPHA);
  });

  it('starts at 0.72 at the top edge and ends transparent at its foot', () => {
    expect(alphaAt(1)).toBeCloseTo(0.72, 1);
    expect(alphaAt(240)).toBe(0);
  });
});

describe('the layer of the top bar', () => {
  it('keeps a permanent compositor layer for transform and opacity, so it moves without a repaint', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');
    const rule = /^\.topbar \{[^}]*\}/m.exec(css)![0];
    expect(rule).toMatch(/will-change:\s*transform,\s*opacity/);
  });
});
