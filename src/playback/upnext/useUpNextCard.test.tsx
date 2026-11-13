import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EpisodeRef } from '../episodes/neighbours';
import { recordAutoAdvance, resetStillWatchingStreak } from './stillWatching';
import { useUpNextCard } from './useUpNextCard';

const NEXT: EpisodeRef = { contentId: 'e12', seasonNumber: 1, episodeNumber: 2, title: 'Two' };
const REGION = { start: 2400, end: 2700 };

beforeEach(() => {
  window.localStorage.clear();
  resetStillWatchingStreak();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function setup(overrides: Partial<Parameters<typeof useUpNextCard>[0]> = {}) {
  const start = vi.fn();
  const cancel = vi.fn();
  const view = renderHook((props: Parameters<typeof useUpNextCard>[0]) => useUpNextCard(props), {
    initialProps: {
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2400,
      cancelled: false,
      cancel,
      start,
      ...overrides,
    },
  });
  return { ...view, start, cancel };
}

describe('the credits card trigger', () => {
  it('shows from the start of the region, and not before it', () => {
    const { result, rerender, start, cancel } = setup({ position: 2399.9 });
    expect(result.current.shown).toBe(false);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2400,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.shown).toBe(true);
    expect(result.current.seconds).toBe(10);
  });

  it('is gone at the end of the region (end exclusive)', () => {
    const { result, rerender, start, cancel } = setup({ position: 2699.9 });
    expect(result.current.shown).toBe(true);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2700,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.shown).toBe(false);
  });

  it.each([
    ['no region', { region: null }],
    ['no next episode', { next: null }],
    ['cancelled for this episode', { cancelled: true }],
    ['not enabled', { enabled: false }],
  ])('does not show with %s', (_name, overrides) => {
    const { result } = setup(overrides);
    expect(result.current.shown).toBe(false);
  });

  it('does not show once the still-watching gate is closed', () => {
    window.localStorage.setItem('silo-tv.settings.stillWatchingThreshold', '1');
    recordAutoAdvance();
    const { result } = setup();
    expect(result.current.shown).toBe(false);
  });

  it('shows while the gate is still open (N advances allowed)', () => {
    window.localStorage.setItem('silo-tv.settings.stillWatchingThreshold', '2');
    recordAutoAdvance();
    const { result } = setup();
    expect(result.current.shown).toBe(true);
  });
});

describe('the credits card countdown', () => {
  it('counts 10 s and then starts the next episode by itself, once', () => {
    const { result, start } = setup();
    advance(9000);
    expect(result.current.seconds).toBe(1);
    expect(start).not.toHaveBeenCalled();
    advance(1000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(true);
    advance(5000);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts over when the playhead leaves the region and enters it again', () => {
    const { result, rerender, start, cancel } = setup();
    advance(5000);
    expect(result.current.seconds).toBe(5);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 100,
      cancelled: false,
      cancel,
      start,
    });
    advance(20_000);
    expect(start).not.toHaveBeenCalled();
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2500,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.seconds).toBe(10);
  });

  it('stops counting when it is cancelled', () => {
    const { rerender, start, cancel } = setup();
    advance(5000);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2500,
      cancelled: true,
      cancel,
      start,
    });
    advance(20_000);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the credits card buttons', () => {
  it('OK on Play now is the viewer’s start', () => {
    const { result, start } = setup();
    act(() => result.current.activate());
    expect(start).toHaveBeenCalledWith(false);
  });

  it('Right moves to Cancel, OK there cancels, Left goes back to Play now', () => {
    const { result, start, cancel } = setup();
    expect(result.current.choice).toBe('play');
    let moved = false;
    act(() => {
      moved = result.current.move('right');
    });
    expect(moved).toBe(true);
    expect(result.current.choice).toBe('cancel');
    act(() => {
      moved = result.current.move('right');
    });
    expect(moved).toBe(false);
    act(() => result.current.activate());
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    act(() => {
      moved = result.current.move('left');
    });
    expect(moved).toBe(true);
    expect(result.current.choice).toBe('play');
  });

  it('Back (dismiss) cancels while it shows and reports nothing to dismiss otherwise', () => {
    const shownCard = setup();
    let dismissed = false;
    act(() => {
      dismissed = shownCard.result.current.dismiss();
    });
    expect(dismissed).toBe(true);
    expect(shownCard.cancel).toHaveBeenCalledTimes(1);

    const hidden = setup({ position: 0 });
    act(() => {
      dismissed = hidden.result.current.dismiss();
    });
    expect(dismissed).toBe(false);
    expect(hidden.cancel).not.toHaveBeenCalled();
  });

  it('starts on Play now again each time it appears', () => {
    const { result, rerender, start, cancel } = setup();
    act(() => void result.current.move('right'));
    expect(result.current.choice).toBe('cancel');
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 0,
      cancelled: false,
      cancel,
      start,
    });
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2500,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.choice).toBe('play');
  });
});

describe('the credits card without auto-play', () => {
  it('shows, but counts nothing and starts nothing by itself', () => {
    const { result, start } = setup({ autoPlay: false });
    expect(result.current.shown).toBe(true);
    expect(result.current.counting).toBe(false);
    advance(30_000);
    expect(start).not.toHaveBeenCalled();
  });

  it('OK on Play now is still the viewer’s start', () => {
    const { result, start } = setup({ autoPlay: false });
    act(() => result.current.activate());
    expect(start).toHaveBeenCalledWith(false);
  });

  it('with auto-play on, it counts', () => {
    const { result } = setup();
    expect(result.current.counting).toBe(true);
  });

  it('turning auto-play off while it shows stops the countdown', () => {
    const { result, rerender, start, cancel } = setup();
    advance(5000);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: false,
      position: 2500,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.shown).toBe(true);
    advance(30_000);
    expect(start).not.toHaveBeenCalled();
  });

  it('turning auto-play on while it shows starts a fresh 10 s countdown', () => {
    const { result, rerender, start, cancel } = setup({ autoPlay: false });
    advance(20_000);
    rerender({
      enabled: true,
      region: REGION,
      next: NEXT,
      autoPlay: true,
      position: 2500,
      cancelled: false,
      cancel,
      start,
    });
    expect(result.current.seconds).toBe(10);
    advance(9000);
    expect(start).not.toHaveBeenCalled();
    advance(1000);
    expect(start).toHaveBeenCalledWith(true);
  });
});
