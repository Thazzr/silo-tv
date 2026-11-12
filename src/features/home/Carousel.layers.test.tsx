import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { Hero } from './Hero';

// The carousel's picture is shaded like the web's hero: four thin layers, not one heavy shade.
const css = readFileSync(resolve(process.cwd(), 'src/styles/media.css'), 'utf-8').replace(
  /\r\n/g,
  '\n',
);

/** The declarations of the rule whose selector is exactly `selector`, whitespace collapsed. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at)).replace(/\s+/g, ' ').trim();
}

describe('Carousel: layers over the slides', () => {
  it('has the dimming, the bottom and left fades and the vignette, and not the card hero shade', () => {
    renderWithSilo(
      <Hero
        item={null}
        featured={{
          kind: 'slides',
          slides: [catalogItem({ title: 'A' })],
          onPlay: () => undefined,
          onOpen: () => undefined,
        }}
      />,
    );
    const carousel = screen.getByTestId('hero-carousel');
    for (const name of ['hero-dim', 'hero-fade-bottom', 'hero-fade-left', 'hero-vignette']) {
      expect(carousel.querySelector(`.${name}`), name).not.toBeNull();
    }
    expect(carousel.querySelector('.hero-shade')).toBeNull();
  });

  it('dims the picture by 10 % with a layer, not a filter', () => {
    expect(rule(css, '.hero-dim')).toContain('background: rgba(0, 0, 0, 0.1)');
    expect(css).not.toMatch(/filter:\s*brightness/);
  });

  it("fades from the bottom with the web's stops", () => {
    expect(rule(css, '.hero-fade-bottom')).toContain(
      'linear-gradient( 0deg, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 0.88) 12%, rgba(0, 0, 0, 0.48) 30%, rgba(0, 0, 0, 0.12) 50%, rgba(0, 0, 0, 0) 66% )',
    );
  });

  it("fades from the left with the web's stops", () => {
    expect(rule(css, '.hero-fade-left')).toContain(
      'linear-gradient( 90deg, rgba(0, 0, 0, 0.88) 0, rgba(0, 0, 0, 0.58) 16%, rgba(0, 0, 0, 0.22) 34%, rgba(0, 0, 0, 0) 50% )',
    );
  });

  it('has a vignette that is 18 % black at the edge', () => {
    const vignette = rule(css, '.hero-vignette');
    expect(vignette).toContain('rgba(0, 0, 0, 0) 55%');
    expect(vignette).toContain('rgba(0, 0, 0, 0.18) 100%');
  });

  it("gives the library's hero the stronger bottom fade and a top scrim", () => {
    expect(css).toContain('.library-stage .hero-fade-bottom');
    expect(css).toContain('.library-stage .hero-top-scrim');
    expect(css).toContain('rgba(0, 0, 0, 0.86) 26%');
  });
});
