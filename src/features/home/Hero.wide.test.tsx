import { act, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../../ui/media';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { Hero, HERO_REST_MS } from './Hero';

const episode = catalogItem({
  content_id: 'e1',
  type: 'episode',
  title: 'Chapter Seven',
  series_title: 'Verity',
  season_number: 4,
  episode_number: 7,
  position_seconds: 600,
  duration_seconds: 3600,
});
const heat = catalogItem({ content_id: 'heat', title: 'Heat', year: 1995, runtime: 170 });

// The harness hands its setter to the test through this object.
const control: { set: (card: { item: CatalogItem; wide: boolean }) => void } = { set: () => {} };

function Harness({ first }: { first: { item: CatalogItem; wide: boolean } }) {
  const [card, set] = useState(first);
  useEffect(() => {
    control.set = set;
  }, [set]);
  return <Hero item={card.item} wide={card.wide} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Hero over a wide card', () => {
  it('adds the episode line and the time left that the card shows', () => {
    renderWithSilo(<Hero item={episode} wide />);
    expect(screen.getByTestId('hero-episode')).toHaveTextContent(
      'Season 4 Episode 7 • Chapter Seven',
    );
    expect(screen.getByTestId('hero-status')).toHaveTextContent('50 min left');
  });

  it('adds nothing over a card of a poster row, whatever the item is', () => {
    renderWithSilo(<Hero item={episode} />);
    expect(screen.queryByTestId('hero-episode')).toBeNull();
    expect(screen.queryByTestId('hero-status')).toBeNull();
  });

  it('leaves out the episode line of a movie and says how much of it is left', () => {
    renderWithSilo(<Hero item={heat} wide />);
    expect(screen.queryByTestId('hero-episode')).toBeNull();
    expect(screen.getByTestId('hero-status')).toHaveTextContent('170 min left');
  });

  it('changes the lines together with the card, after the focus has rested', () => {
    renderWithSilo(<Harness first={{ item: episode, wide: true }} />);
    act(() => control.set({ item: heat, wide: false }));
    // Not yet: the old card keeps its own lines, and the new one has not taken over.
    expect(screen.getByTestId('hero-status')).toHaveTextContent('50 min left');
    act(() => void vi.advanceTimersByTime(HERO_REST_MS));
    expect(screen.queryByTestId('hero-status')).toBeNull();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Heat');
  });

  it('follows a change of the kind alone: the same item shown by a poster row after a wide one', () => {
    renderWithSilo(<Harness first={{ item: episode, wide: true }} />);
    act(() => control.set({ item: episode, wide: false }));
    act(() => void vi.advanceTimersByTime(HERO_REST_MS));
    expect(screen.queryByTestId('hero-status')).toBeNull();
    expect(screen.queryByTestId('hero-episode')).toBeNull();
  });
});
