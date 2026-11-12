import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFocus } from '../../app/nav';
import { BASE_URL } from '../../test/apiFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { KEY } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import type { CatalogItem } from '../../ui/media';
import { CAROUSEL_TURN_MS, HERO_PAGER_KEY } from './Carousel';
import { Hero } from './Hero';

// More of the carousel's details (fake timers): which pictures are loaded and for how long, the
// slide list changing under it, and the keys on a later slide.
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

const control: { set: (slides: CatalogItem[]) => void } = { set: () => {} };

function Harness({
  initial,
  onPlay,
}: {
  initial: CatalogItem[];
  onPlay: (item: CatalogItem) => void;
}) {
  const [list, set] = useState(initial);
  useEffect(() => {
    control.set = set;
  }, [set]);
  return (
    <Hero
      item={null}
      featured={{ kind: 'slides', slides: list, onPlay, onOpen: () => undefined }}
    />
  );
}

function setup(list: CatalogItem[]) {
  const onPlay = vi.fn<(item: CatalogItem) => void>();
  renderWithSilo(<Harness initial={list} onPlay={onPlay} />);
  return { onPlay };
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
const src = (n: number) => `${BASE_URL}/img/slide-${n}-backdrop.webp`;
const loaded = () =>
  Array.from(document.querySelectorAll<HTMLImageElement>('.hero-slide-img')).map((img) =>
    img.getAttribute('src'),
  );
const number = () => screen.getByTestId('hero-slide-number').textContent;

describe('Carousel: the pictures that stay loaded', () => {
  it('keeps the fading slide for exactly one second, not a moment less', async () => {
    setup(slides(4));
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    // The crossfade is one second (the stylesheet's 1000 ms), so the picture goes then.
    wait(999);
    expect(loaded()).toContain(src(1));
    wait(1);
    expect(loaded()).not.toContain(src(1));
  });

  it('keeps the fading slide until a second after the last of two quick pages', async () => {
    setup(slides(5));
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    wait(500);
    await press(KEY.right);
    expect(number()).toBe('03');
    // The second page's own fade runs 1 s: slide 2 is still there 999 ms after it, gone after 1000.
    wait(999);
    expect(loaded()).toContain(src(2));
    wait(1);
    expect(loaded()).not.toContain(src(2));
  });

  it('preloads the first slide while the last one is shown', async () => {
    setup(slides(3));
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    await press(KEY.right);
    expect(number()).toBe('03');
    wait(1000);
    expect(loaded()).toEqual([src(1), src(3)]);
  });

  it("keeps each picture's loaded state when the slides come in another order", () => {
    setup(slides(3));
    // Slide 1 is active; its picture finished loading.
    fireEvent.load(document.querySelector(`img[src="${src(1)}"]`)!);
    expect(document.querySelector(`img[src="${src(1)}"]`)).toHaveAttribute('data-loaded', 'true');
    const [one, two, three] = slides(3) as [CatalogItem, CatalogItem, CatalogItem];
    act(() => control.set([two, one, three]));
    // Slide 2 is now the first one: it has not loaded, slide 1 (second, preloaded) still has.
    expect(document.querySelector(`img[src="${src(1)}"]`)).toHaveAttribute('data-loaded', 'true');
    expect(document.querySelector(`img[src="${src(2)}"]`)).toHaveAttribute('data-loaded', 'false');
  });
});

describe('Carousel: a single slide', () => {
  it('never schedules a turn', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    setup(slides(1));
    wait(CAROUSEL_TURN_MS * 2);
    expect(spy.mock.calls.some(([, delay]) => delay === CAROUSEL_TURN_MS)).toBe(false);
    spy.mockRestore();
  });

  it('schedules the turn with several slides', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    setup(slides(3));
    expect(spy.mock.calls.some(([, delay]) => delay === CAROUSEL_TURN_MS)).toBe(true);
    spy.mockRestore();
  });
});

describe('Carousel: the slide list changes', () => {
  it('shows the last slide when the list shrinks below the one that was shown', async () => {
    setup(slides(3));
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    await press(KEY.right);
    expect(number()).toBe('03');
    act(() => control.set(slides(2)));
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Slide 2');
    expect(number()).toBe('02');
  });
});

describe('Carousel: the keys on a later slide', () => {
  it("the remote's Play key plays the slide that was paged to, not the first", async () => {
    const { onPlay } = setup(slides(3));
    await focus(HERO_PAGER_KEY);
    await press(KEY.right);
    fireEvent.keyDown(document.activeElement!, { keyCode: 415 });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0]![0].content_id).toBe('slide-2');
  });
});

describe('Carousel: the meta line', () => {
  it('draws none for an item without year, runtime, rating and genres', () => {
    setup([slide(1, { year: 0, runtime: undefined, genres: [], content_rating: undefined })]);
    expect(screen.queryByTestId('hero-meta')).toBeNull();
  });
});
