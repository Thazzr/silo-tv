import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { boxSetSummary } from '../../test/boxSetFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { setFocus } from '../../app/nav';
import { BoxSetCard, ExploreAllCard, LandscapeCard, PersonCard, PosterCard } from './Cards';

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

  it('resolves the image against the server and loads it eagerly (the row mounts only near cards)', () => {
    poster();
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`${BASE_URL}/img/heat.webp`);
    // A lazy image waits until it is near the viewport, so a row that scrolls shows empty cards.
    expect(img.getAttribute('loading')).toBeNull();
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('shows the thumbhash colour behind the image, which needs no re-render when it loads', () => {
    poster();
    const art = screen.getByTestId('art');
    expect(art.style.backgroundColor).toMatch(/^rgb\(/);
    const img = document.querySelector('img')!;
    fireEvent.load(img);
    // Same element, still there: the picture paints over the colour, nothing swaps or fades.
    expect(document.querySelector('img')).toBe(img);
    expect(screen.getByTestId('art')).toBe(art);
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

describe('PosterCard badge', () => {
  it('shows a pill on the picture when given a badge, and none otherwise', () => {
    poster({ badge: 'THIS FILM' });
    expect(screen.getByTestId('card-pill-start')).toHaveTextContent('THIS FILM');
  });

  it('has no pill without a badge', () => {
    poster();
    expect(screen.queryByTestId('card-pill-start')).toBeNull();
  });
});

describe('BoxSetCard', () => {
  const summary = boxSetSummary({
    poster_url: '/img/saga.webp',
    movie_count: 8,
    played_count: 0,
    first_year: 2001,
    last_year: 2011,
  });
  const box = (boxSet = summary, extra: Partial<Parameters<typeof BoxSetCard>[0]> = {}) =>
    renderWithSilo(
      <BoxSetCard boxSet={boxSet} focusKey="bs1" onOpen={() => undefined} {...extra} />,
    );

  it('is a poster card with a BOX SET pill top left and the film count bottom right', () => {
    box();
    expect(screen.getByRole('button', { name: /Great Saga Box Set/ })).toHaveClass('card-poster');
    expect(screen.getByTestId('card-pill-start')).toHaveTextContent('BOX SET');
    expect(screen.getByTestId('card-pill-end')).toHaveTextContent('8 films');
    expect(document.querySelector('img')?.getAttribute('src')).toBe(`${BASE_URL}/img/saga.webp`);
  });

  it('says "1 film" for one film', () => {
    box(boxSetSummary({ movie_count: 1 }));
    expect(screen.getByTestId('card-pill-end')).toHaveTextContent('1 film');
  });

  it('shows the title and the years while nothing is played', () => {
    box();
    expect(screen.getByTestId('card-title')).toHaveTextContent('Great Saga Box Set');
    expect(screen.getByTestId('card-sub')).toHaveTextContent('2001–2011');
  });

  it('shows how many films are watched once one is', () => {
    box(boxSetSummary({ movie_count: 8, played_count: 5 }));
    expect(screen.getByTestId('card-sub')).toHaveTextContent('5 / 8 watched');
  });

  it('is a grid card on request, opens on click and reports its focus', async () => {
    const onOpen = vi.fn();
    const onFocused = vi.fn();
    box(summary, { grid: true, onOpen, onFocused });
    expect(screen.getByRole('button', { name: /Great Saga/ })).toHaveClass('card-grid');
    await act(async () => {
      await setFocus('bs1');
    });
    expect(onFocused).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Great Saga/ }));
    expect(onOpen).toHaveBeenCalledWith(summary);
  });

  it('falls back to a title tile without a poster', () => {
    box(boxSetSummary({ poster_url: undefined }));
    expect(screen.getByTestId('art-tile')).toHaveTextContent('Great Saga Box Set');
  });
});

describe('PosterCard subtitle', () => {
  it('shows the given second line instead of the year', () => {
    poster({ subtitle: 'S1 · E2 · Pilot' });
    expect(screen.getByTestId('card-sub')).toHaveTextContent('S1 · E2 · Pilot');
  });
});

describe('PersonCard compact', () => {
  it('is a round portrait card with the name under it', () => {
    renderWithSilo(
      <PersonCard name="Sage Actor" initials="SA" focusKey="p" compact onOpen={() => undefined} />,
    );
    const card = screen.getByRole('button', { name: 'Sage Actor' });
    expect(card).toHaveClass('card-person');
    expect(card).not.toHaveClass('card-poster');
    expect(screen.getByTestId('card-title')).toHaveTextContent('Sage Actor');
  });
});
