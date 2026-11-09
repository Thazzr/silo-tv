import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { setFocus } from '../../app/nav';
import { ExploreAllCard, LandscapeCard, PosterCard } from './Cards';

/** A ThumbHash with a mid-grey average, so a placeholder colour is visible. */
const GREY_HEADER = 32 | (32 << 6) | (32 << 12);
const GREY_HASH = btoa(
  String.fromCharCode(GREY_HEADER & 255, (GREY_HEADER >> 8) & 255, (GREY_HEADER >> 16) & 255, 0, 0),
);

const movie = catalogItem({
  content_id: 'm1',
  title: 'Heat',
  year: 1995,
  poster_url: '/img/heat.webp',
  poster_thumbhash: GREY_HASH,
});

function poster(overrides: Partial<Parameters<typeof PosterCard>[0]> = {}) {
  return renderWithSilo(
    <PosterCard item={movie} focusKey="card-1" onOpen={() => undefined} {...overrides} />,
  );
}

describe('PosterCard', () => {
  it('shows the title and the year under the picture', () => {
    poster();
    expect(screen.getByTestId('card-title')).toHaveTextContent('Heat');
    expect(screen.getByTestId('card-sub')).toHaveTextContent('1995');
    expect(screen.getByRole('button', { name: /Heat/ })).toHaveClass('card-poster');
  });

  it('is a grid card with the grid class', () => {
    poster({ grid: true });
    expect(screen.getByRole('button', { name: /Heat/ })).toHaveClass('card-grid');
  });

  it('resolves the image against the server and loads it lazily', () => {
    poster();
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`${BASE_URL}/img/heat.webp`);
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('shows the thumbhash colour while the image loads, then the image', () => {
    poster();
    const art = screen.getByTestId('art');
    expect(art).toHaveAttribute('data-state', 'loading');
    expect(art.style.backgroundColor).toMatch(/^rgb\(/);
    fireEvent.load(document.querySelector('img')!);
    expect(art).toHaveAttribute('data-state', 'loaded');
  });

  it('falls back to a title tile when the image fails', () => {
    poster();
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('art-tile')).toHaveTextContent('Heat');
  });

  it('shows the title tile at once when the item has no picture', () => {
    poster({ item: catalogItem({ title: 'No Art', poster_url: undefined }) });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('art-tile')).toHaveTextContent('No Art');
  });

  it('opens the item on click and reports its focus', async () => {
    const onOpen = vi.fn();
    const onFocused = vi.fn();
    poster({ onOpen, onFocused });
    await act(async () => {
      await setFocus('card-1');
    });
    expect(onFocused).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Heat/ }));
    expect(onOpen).toHaveBeenCalledWith(movie);
  });

  it('shows an episode under its series with the season and episode label', () => {
    poster({
      item: catalogItem({
        type: 'episode',
        title: 'Pilot',
        series_title: 'Severance',
        season_number: 1,
        episode_number: 3,
      }),
    });
    expect(screen.getByTestId('card-title')).toHaveTextContent('Severance');
    expect(screen.getByTestId('card-sub')).toHaveTextContent('S1 · E3');
  });
});

describe('LandscapeCard', () => {
  const resuming = catalogItem({
    content_id: 'e1',
    type: 'episode',
    title: 'Pilot',
    series_title: 'Severance',
    season_number: 1,
    episode_number: 3,
    backdrop_url: '/img/sev-backdrop.webp',
    position_seconds: 600,
    duration_seconds: 2400,
  });

  function landscape(item = resuming) {
    return renderWithSilo(<LandscapeCard item={item} focusKey="l1" onOpen={() => undefined} />);
  }

  it('is a landscape card with the backdrop, the series title and "S1 · E3"', () => {
    landscape();
    expect(screen.getByRole('button', { name: /Severance/ })).toHaveClass('card-landscape');
    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      `${BASE_URL}/img/sev-backdrop.webp`,
    );
    expect(screen.getByTestId('card-sub')).toHaveTextContent('S1 · E3');
  });

  it('draws the progress bar from the resume position', () => {
    landscape();
    expect(screen.getByTestId('card-progress').style.width).toBe('25%');
  });

  it('draws no progress bar without a resume position', () => {
    landscape({ ...resuming, position_seconds: undefined });
    expect(screen.queryByTestId('card-progress')).toBeNull();
  });

  it('draws no progress bar on a "next up" card', () => {
    landscape({ ...resuming, item_source: 'next_up' });
    expect(screen.queryByTestId('card-progress')).toBeNull();
  });
});

describe('ExploreAllCard', () => {
  it('has the shape of its row, names its row and opens it', () => {
    const onOpen = vi.fn();
    renderWithSilo(
      <ExploreAllCard shape="landscape" rowTitle="Next Up" focusKey="x" onOpen={onOpen} />,
    );
    const card = screen.getByRole('button', { name: 'Explore all, Next Up' });
    expect(card).toHaveClass('card-landscape');
    expect(screen.getByText('Explore all')).toBeInTheDocument();
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
