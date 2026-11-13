import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../../platform';
import {
  getStillWatchingThreshold,
  isStillWatchingGated,
  recordAutoAdvance,
  resetStillWatchingStreak,
  setStillWatchingThreshold,
} from './stillWatching';

function store(initial?: string): KeyValueStore & { raw(): string | null } {
  let value: string | null = initial ?? null;
  return {
    get: () => value,
    set: (_key, next) => {
      value = next;
    },
    remove: () => {
      value = null;
    },
    raw: () => value,
  };
}

beforeEach(() => resetStillWatchingStreak());

describe('still-watching threshold', () => {
  it('is 3 when nothing is stored', () => {
    expect(getStillWatchingThreshold(store())).toBe(3);
  });

  it('reads a stored value in range, 0 (never ask) and the limits included', () => {
    expect(getStillWatchingThreshold(store('5'))).toBe(5);
    expect(getStillWatchingThreshold(store('0'))).toBe(0);
    expect(getStillWatchingThreshold(store('20'))).toBe(20);
  });

  it.each(['-1', '21', '2.5', 'abc', '', ' 3'])('falls back to 3 for %j', (raw) => {
    expect(getStillWatchingThreshold(store(raw))).toBe(3);
  });

  it('persists a set value and refuses one the contract does not allow', () => {
    const s = store();
    setStillWatchingThreshold(7, s);
    expect(s.raw()).toBe('7');
    setStillWatchingThreshold(21, s);
    setStillWatchingThreshold(1.5, s);
    setStillWatchingThreshold(-1, s);
    expect(getStillWatchingThreshold(s)).toBe(7);
  });
});

describe('still-watching gate', () => {
  it('lets N automatic advances through and stops the next one', () => {
    const s = store('2');
    expect(isStillWatchingGated(s)).toBe(false);
    recordAutoAdvance();
    expect(isStillWatchingGated(s)).toBe(false);
    recordAutoAdvance();
    expect(isStillWatchingGated(s)).toBe(true);
    recordAutoAdvance();
    expect(isStillWatchingGated(s)).toBe(true);
  });

  it('is cleared by a start the viewer made', () => {
    const s = store('1');
    recordAutoAdvance();
    expect(isStillWatchingGated(s)).toBe(true);
    resetStillWatchingStreak();
    expect(isStillWatchingGated(s)).toBe(false);
  });

  it('never asks with a threshold of 0', () => {
    const s = store('0');
    for (let i = 0; i < 25; i += 1) recordAutoAdvance();
    expect(isStillWatchingGated(s)).toBe(false);
  });
});
