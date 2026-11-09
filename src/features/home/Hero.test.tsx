import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import type { CatalogItem } from '../../ui/media';
import { Hero, HERO_REST_MS, HeroSkeleton } from './Hero';

// The harness hands its setter to the tests through this object.
const control: { set: (item: CatalogItem | null) => void } = { set: () => {} };

function Harness({ initial }: { initial: CatalogItem | null }) {
  const [item, set] = useState<CatalogItem | null>(initial);
  useEffect(() => {
    control.set = set;
  }, [set]);
  return <Hero item={item} />;
}

const heat = catalogItem({
  content_id: 'heat',
  title: 'Heat',
  year: 1995,
  runtime: 170,
  content_rating: 'R',
  overview: 'A group of professional bank robbers.',
  backdrop_url: '/img/heat-backdrop.webp',
});
const alien = catalogItem({ content_id: 'alien', title: 'Alien', year: 1979, runtime: 117 });
const ronin = catalogItem({ content_id: 'ronin', title: 'Ronin', year: 1998 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const shown = () => screen.getByTestId('hero').getAttribute('data-content-id');
const change = (item: CatalogItem | null) => act(() => control.set(item));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Hero', () => {
  it('shows the first item at once: title, meta line, synopsis and the backdrop', () => {
    renderWithSilo(<Harness initial={heat} />);
    expect(shown()).toBe('heat');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('1995 · 2 h 50 min · R');
    expect(screen.getByTestId('hero-synopsis')).toHaveTextContent('A group of professional');
    expect(screen.getByTestId('hero-backdrop').getAttribute('src')).toBe(
      `${BASE_URL}/img/heat-backdrop.webp`,
    );
  });

  it('follows the focus only after it has rested', () => {
    renderWithSilo(<Harness initial={heat} />);
    change(alien);
    wait(HERO_REST_MS - 50);
    expect(shown()).toBe('heat');
    wait(50);
    expect(shown()).toBe('alien');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('1979 · 1 h 57 min');
  });

  it('does not update while the focus runs across cards', () => {
    renderWithSilo(<Harness initial={heat} />);
    change(alien);
    wait(100);
    change(ronin);
    wait(100);
    change(alien);
    wait(100);
    // 300 ms passed, but no card held the focus for the rest delay.
    expect(shown()).toBe('heat');
    wait(HERO_REST_MS);
    expect(shown()).toBe('alien');
  });

  it('shows the title art when there is one, the title otherwise', () => {
    renderWithSilo(<Harness initial={catalogItem({ ...heat, logo_url: '/img/heat-logo.webp' })} />);
    const logo = screen.getByTestId('hero-logo');
    expect(logo.getAttribute('src')).toBe(`${BASE_URL}/img/heat-logo.webp`);
    expect(logo).toHaveAttribute('alt', 'Heat');
    expect(screen.queryByTestId('hero-title')).toBeNull();
    // The art fails: the title takes its place.
    fireEvent.error(logo);
    expect(screen.queryByTestId('hero-logo')).toBeNull();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
  });

  it('shows the series art and title for an episode', () => {
    renderWithSilo(
      <Harness
        initial={catalogItem({
          type: 'episode',
          title: 'Pilot',
          series_title: 'Severance',
          season_number: 1,
          episode_number: 3,
          runtime: 40,
          backdrop_url: '/img/episode-still.webp',
          series_backdrop_url: '/img/series-backdrop.webp',
        })}
      />,
    );
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Severance');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('S1 · E3 · 40 min');
    expect(screen.getByTestId('hero-backdrop').getAttribute('src')).toBe(
      `${BASE_URL}/img/series-backdrop.webp`,
    );
  });

  it('is empty without an item', () => {
    renderWithSilo(<Harness initial={null} />);
    expect(screen.getByTestId('hero')).toBeEmptyDOMElement();
    change(heat);
    wait(HERO_REST_MS);
    expect(shown()).toBe('heat');
  });
});

describe('HeroSkeleton', () => {
  it('has bars where the title, the meta line and the synopsis go', () => {
    renderWithSilo(<HeroSkeleton />);
    expect(screen.getByTestId('hero-skeleton').querySelectorAll('.skeleton-bar')).toHaveLength(3);
  });
});
