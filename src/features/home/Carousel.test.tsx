import { act, fireEvent, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFocus } from '../../app/nav';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { KEY } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import type { CatalogItem } from '../../ui/media';
import {
  CAROUSEL_FADE_MS,
  CAROUSEL_TURN_MS,
  HERO_INFO_KEY,
  HERO_PAGER_KEY,
  HERO_PLAY_KEY,
} from './Carousel';
import { Hero, type Featured } from './Hero';

// Fake timers: the carousel turns after 8 s, which a test must not wait out. Keys are sent as
// plain events (the navigation answers within a few promise ticks); no test here needs the
// spatial search.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const slide = (n: number, overrides: Partial<CatalogItem> = {}) =>
  catalogItem({
    content_id: `slide-${n}`,
    title: `Slide ${n}`,
    year: 2000 + n,
    runtime: 100 + n,
    genres: ['Drama'],
    content_rating: 'PG',
    overview: `Synopsis ${n}`,
    backdrop_url: `/img/slide-${n}-backdrop.webp`,
    ...overrides,
  });

const slides = (count: number) => Array.from({ length: count }, (_, i) => slide(i + 1));

const control: { set: (item: CatalogItem | null) => void } = { set: () => {} };

function Harness({
  featured,
  initial = null,
}: {
  featured: Featured | null;
  initial?: CatalogItem | null;
}) {
  const [item, set] = useState<CatalogItem | null>(initial);
  useEffect(() => {
    control.set = set;
  }, [set]);
  return <Hero item={item} featured={featured} />;
}

function setup(count = 3, overrides: Partial<Extract<Featured, { kind: 'slides' }>> = {}) {
  const onPlay = vi.fn<(item: CatalogItem) => void>();
  const onOpen = vi.fn<(item: CatalogItem) => void>();
  const featured: Featured = {
    kind: 'slides',
    slides: slides(count),
    onPlay,
    onOpen,
    ...overrides,
  };
  const view = renderWithSilo(<Harness featured={featured} />);
  return { onPlay, onOpen, ...view };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const focus = async (focusKey: string) => {
  await act(async () => {
    await setFocus(focusKey);
  });
  await flush();
};
const press = async (keyCode: number) => {
  fireEvent.keyDown(window, { keyCode });
  fireEvent.keyUp(window, { keyCode });
  await flush();
};
const number = () => screen.getByTestId('hero-slide-number').textContent;
const title = () => screen.getByTestId('hero-title').textContent;
const pager = () => screen.getByTestId('hero-carousel').querySelector('.hero-pager')!;
const loadedImages = () =>
  Array.from(document.querySelectorAll<HTMLImageElement>('.hero-slide-img')).map((img) =>
    img.getAttribute('src'),
  );

describe('Carousel: what a slide shows', () => {
  it('shows the title as text with the meta line, the synopsis and the two buttons, and no kicker', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Featured content' })).toBeInTheDocument();
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Slide 1');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('2001 · 1h 41m · Drama · PG');
    expect(screen.getByTestId('hero-synopsis')).toHaveTextContent('Synopsis 1');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More Info' })).toBeInTheDocument();
    // The web's kicker ("Featured - No. 01") is not drawn: the number lives in the indicator.
    expect(screen.queryByText(/Featured$|^Featured\b|No\. 0/)).toBeNull();
  });

  it('shows the title as text even when the item has title art', () => {
    const withLogo = [slide(1, { logo_url: '/img/slide-1-logo.webp' }), slide(2)];
    setup(2, { slides: withLogo });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Slide 1');
    expect(screen.queryByTestId('hero-logo')).toBeNull();
    expect(document.querySelector('img[src$="slide-1-logo.webp"]')).toBeNull();
  });

  it('shows the series title and "S4 · E7" for an episode slide', () => {
    const episode = slide(1, {
      type: 'episode',
      title: 'Chapter seven',
      series_title: 'Verity',
      season_number: 4,
      episode_number: 7,
      runtime: 52,
    });
    setup(2, { slides: [episode, slide(2)] });
    expect(title()).toBe('Verity');
    expect(screen.getByTestId('hero-meta')).toHaveTextContent('S4 · E7 · 52 min · PG');
  });

  it('numbers the slides with two digits in the indicator, which names the pause', () => {
    setup(10);
    expect(number()).toBe('01');
    expect(screen.getByTestId('hero-slide-count').textContent).toBe('10');
    expect(screen.getByRole('button', { name: 'Pause slideshow' })).toBe(pager());
  });

  it('has no indicator and never turns with a single slide', () => {
    setup(1);
    expect(screen.queryByRole('button', { name: 'Pause slideshow' })).toBeNull();
    wait(CAROUSEL_TURN_MS * 3);
    expect(title()).toBe('Slide 1');
  });
});

describe('Carousel: the turning', () => {
  it('turns after 8 s and not before', () => {
    setup();
    wait(CAROUSEL_TURN_MS - 100);
    expect(number()).toBe('01');
    wait(100);
    expect(number()).toBe('02');
    expect(title()).toBe('Slide 2');
  });

  it('wraps from the last slide to the first', () => {
    setup(3);
    // One turn at a time: the next 8 s are scheduled when the slide has rendered.
    wait(CAROUSEL_TURN_MS);
    wait(CAROUSEL_TURN_MS);
    expect(number()).toBe('03');
    wait(CAROUSEL_TURN_MS);
    expect(number()).toBe('01');
  });

  it('crossfades: the active slide is marked, the one before it fades out and is then gone', () => {
    setup(4);
    wait(CAROUSEL_TURN_MS);
    const active = () =>
      screen.getAllByTestId('hero-slide').filter((el) => el.getAttribute('data-active') === 'true');
    expect(active()).toHaveLength(1);
    // Slide 1 is still there (fading out), together with the active slide 2 and the next, 3.
    expect(loadedImages()).toEqual([
      `${BASE_URL}/img/slide-1-backdrop.webp`,
      `${BASE_URL}/img/slide-2-backdrop.webp`,
      `${BASE_URL}/img/slide-3-backdrop.webp`,
    ]);
    wait(CAROUSEL_FADE_MS);
    expect(loadedImages()).toEqual([
      `${BASE_URL}/img/slide-2-backdrop.webp`,
      `${BASE_URL}/img/slide-3-backdrop.webp`,
    ]);
  });

  it('loads only the active, the outgoing and the next backdrop', () => {
    setup(6);
    // Slide 1 is active and 2 is next; the last one (6) is not preloaded for going back.
    expect(loadedImages()).toEqual([
      `${BASE_URL}/img/slide-1-backdrop.webp`,
      `${BASE_URL}/img/slide-2-backdrop.webp`,
    ]);
  });

  it('starts the 8 s afresh after the slide was paged by hand', async () => {
    setup();
    await focus(HERO_PAGER_KEY);
    wait(5000);
    await press(KEY.right);
    expect(number()).toBe('02');
    // 5 s + 7.9 s after the page: the old timer (at 8 s) would have fired by now.
    wait(CAROUSEL_TURN_MS - 100);
    expect(number()).toBe('02');
    wait(100);
    expect(number()).toBe('03');
  });

  it('restarts the rail with every slide', async () => {
    setup();
    const fill = () => screen.getByTestId('hero-rail-fill');
    const first = fill();
    wait(CAROUSEL_TURN_MS);
    expect(fill()).not.toBe(first);
  });
});

describe('Carousel: the focus', () => {
  it('stands still while the focus is on "Play" or "More Info"', async () => {
    setup();
    await focus(HERO_PLAY_KEY);
    wait(CAROUSEL_TURN_MS * 3);
    expect(number()).toBe('01');
    await press(KEY.right);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More Info' }));
    wait(CAROUSEL_TURN_MS * 3);
    expect(number()).toBe('01');
  });

  it('turns while the focus is on the indicator, and again 8 s after it left the buttons', async () => {
    setup();
    await focus(HERO_PLAY_KEY);
    await press(KEY.right);
    await press(KEY.right);
    expect(document.activeElement).toBe(pager());
    // The turn restarts when the focus leaves the buttons, so it comes 8 s after that.
    wait(CAROUSEL_TURN_MS - 100);
    expect(number()).toBe('01');
    wait(100);
    expect(number()).toBe('02');
  });

  it('restarts the rail when the focus leaves the buttons, with the 8 s that start again', async () => {
    setup();
    await focus(HERO_PLAY_KEY);
    const railOnButtons = screen.getByTestId('hero-rail-fill');
    await press(KEY.right);
    await press(KEY.right);
    expect(screen.getByTestId('hero-rail-fill')).not.toBe(railOnButtons);
  });

  it('walks Play, More Info and the indicator with Right and back with Left', async () => {
    setup();
    await focus(HERO_PLAY_KEY);
    await press(KEY.right);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More Info' }));
    await press(KEY.left);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play' }));
    await press(KEY.right);
    await press(KEY.right);
    expect(document.activeElement).toBe(pager());
  });

  it('does not offer the indicator to the right of "More Info" with one slide', async () => {
    setup(1);
    await focus(HERO_INFO_KEY);
    await press(KEY.right);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More Info' }));
  });

  it('pages with Left and Right on the indicator, around the ends', async () => {
    setup(3);
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    expect(number()).toBe('02');
    await press(KEY.left);
    await press(KEY.left);
    expect(number()).toBe('03');
    await press(KEY.right);
    expect(number()).toBe('01');
    expect(document.activeElement).toBe(pager());
  });

  it('OK on the indicator pauses the slideshow and OK again resumes it', async () => {
    setup();
    await focus(HERO_PAGER_KEY);
    await press(KEY.enter);
    const resume = screen.getByRole('button', { name: 'Play slideshow' });
    expect(resume).toBe(pager());
    const railBeforePause = screen.getByTestId('hero-rail-fill');
    expect(document.querySelector('.hero-rail')).toHaveAttribute('data-paused', 'true');
    wait(CAROUSEL_TURN_MS * 3);
    expect(number()).toBe('01');
    await press(KEY.enter);
    expect(screen.getByRole('button', { name: 'Pause slideshow' })).toBe(pager());
    expect(document.querySelector('.hero-rail')).toHaveAttribute('data-paused', 'false');
    // The rail starts afresh with the 8 s that start again.
    expect(screen.getByTestId('hero-rail-fill')).not.toBe(railBeforePause);
    wait(CAROUSEL_TURN_MS);
    expect(number()).toBe('02');
  });

  it('can still be paged by hand while paused', async () => {
    setup();
    await focus(HERO_PAGER_KEY);
    await press(KEY.enter);
    await press(KEY.right);
    expect(number()).toBe('02');
    wait(CAROUSEL_TURN_MS * 2);
    expect(number()).toBe('02');
  });
});

describe('Carousel: the buttons', () => {
  it('"Play" and "More Info" hand over the slide that is shown', async () => {
    const { onPlay, onOpen } = setup();
    wait(CAROUSEL_TURN_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]![0].content_id).toBe('slide-2');
    fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
    expect(onOpen.mock.calls[0]![0].content_id).toBe('slide-2');
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('OK on the focused button presses it', async () => {
    const { onPlay, onOpen } = setup();
    await focus(HERO_PLAY_KEY);
    await press(KEY.enter);
    expect(onPlay).toHaveBeenCalledTimes(1);
    await press(KEY.right);
    await press(KEY.enter);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("the remote's Play key plays the slide that is shown, from any control of the hero", async () => {
    const { onPlay, onOpen } = setup();
    await focus(HERO_PLAY_KEY);
    await press(KEY.right);
    // 415 is the remote's Play key.
    fireEvent.keyDown(document.activeElement!, { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]![0].content_id).toBe('slide-1');
    expect(onOpen).not.toHaveBeenCalled();
    await press(KEY.right);
    expect(document.activeElement).toBe(pager());
    fireEvent.keyDown(pager(), { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledTimes(2);
  });
});

describe('Carousel: the two modes of the hero', () => {
  it('shows the focused card instead, hides the carousel, and returns to the slide it showed', () => {
    setup();
    wait(CAROUSEL_TURN_MS);
    expect(number()).toBe('02');
    const carousel = screen.getByTestId('hero-carousel');
    expect(carousel).toHaveAttribute('data-shown', 'true');

    act(() => control.set(catalogItem({ content_id: 'card', title: 'A card', year: 1999 })));
    expect(carousel).toHaveAttribute('data-shown', 'false');
    // The card is what the hero shows; the carousel is still there under it.
    expect(
      within(document.querySelector('.hero-card')!).getByTestId('hero-title'),
    ).toHaveTextContent('A card');
    expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('card');

    act(() => control.set(null));
    expect(carousel).toHaveAttribute('data-shown', 'true');
    expect(document.querySelector('.hero-card')).toBeNull();
    expect(number()).toBe('02');
    expect(title()).toBe('Slide 2');
  });

  it('does not turn while the card is shown, and the 8 s start afresh when the carousel returns', () => {
    setup();
    wait(CAROUSEL_TURN_MS);
    act(() => control.set(catalogItem({ content_id: 'card', title: 'A card' })));
    wait(CAROUSEL_TURN_MS * 5);
    act(() => control.set(null));
    expect(number()).toBe('02');
    wait(CAROUSEL_TURN_MS - 100);
    expect(number()).toBe('02');
    wait(100);
    expect(number()).toBe('03');
  });

  it('shows a card at once after the carousel, not the one before it', () => {
    setup();
    act(() => control.set(catalogItem({ content_id: 'one', title: 'One' })));
    act(() => control.set(null));
    act(() => control.set(catalogItem({ content_id: 'two', title: 'Two' })));
    expect(screen.getByTestId('hero').getAttribute('data-content-id')).toBe('two');
  });
});
