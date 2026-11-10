import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../platform';
import {
  formatWallClock,
  getTimeMode,
  setTimeMode,
  timeParts,
  TIME_MODES,
  type TimeMode,
} from './timeDisplay';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
};
const throwing: KeyValueStore = {
  get: () => {
    throw new Error('no storage');
  },
  set: () => {
    throw new Error('no storage');
  },
  remove: () => {
    throw new Error('no storage');
  },
};

const MINUS = '−';

describe('the time mode setting', () => {
  it('is Combined by default, and stores a choice under the settings namespace', () => {
    const store = memory();
    expect(getTimeMode(store)).toBe('combined');
    for (const mode of TIME_MODES) {
      setTimeMode(mode, store);
      expect(getTimeMode(store)).toBe(mode);
    }
    expect([...store.data.keys()]).toEqual(['silo-tv.settings.timeDisplay']);
  });

  it('falls back to Combined for an unknown value and when storage throws', () => {
    const store = memory();
    store.set('silo-tv.settings.timeDisplay', 'bogus');
    expect(getTimeMode(store)).toBe('combined');
    expect(getTimeMode(throwing)).toBe('combined');
    expect(() => setTimeMode('endsAt', throwing)).not.toThrow();
  });
});

describe('formatWallClock', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 10, h, m);

  it('writes 24 h with two digits', () => {
    expect(formatWallClock(at(15, 26), '24h', 'en')).toBe('15:26');
    expect(formatWallClock(at(7, 5), '24h', 'de')).toBe('07:05');
    expect(formatWallClock(at(0, 0), '24h', 'en')).toBe('00:00');
  });

  it('writes 12 h with AM and PM, noon and midnight as 12', () => {
    expect(formatWallClock(at(15, 26), '12h', 'de')).toBe('3:26 PM');
    expect(formatWallClock(at(7, 5), '12h', 'de')).toBe('7:05 AM');
    expect(formatWallClock(at(0, 5), '12h', 'de')).toBe('12:05 AM');
    expect(formatWallClock(at(12, 0), '12h', 'de')).toBe('12:00 PM');
  });

  it('follows the language for auto: German 24 h, English 12 h', () => {
    expect(formatWallClock(at(15, 26), 'auto', 'de')).toBe('15:26');
    expect(formatWallClock(at(15, 26), 'auto', 'en')).toBe('3:26 PM');
  });
});

describe('timeParts', () => {
  // 14:00:00 local; 12:12 of 23:32 played, so 11:20 are left and it ends at 14:11:20.
  const now = new Date(2026, 10, 10, 14, 0, 0).getTime();
  const parts = (mode: TimeMode, position = 732, duration = 1412) =>
    timeParts(mode, position, duration, now, '24h', 'de');

  it('Combined has position, length and the end time', () => {
    expect(parts('combined')).toEqual({
      position: '12:12',
      total: '23:32',
      remaining: null,
      endsAt: '14:11',
    });
  });

  it('Position / length has no end time', () => {
    expect(parts('position')).toEqual({
      position: '12:12',
      total: '23:32',
      remaining: null,
      endsAt: null,
    });
  });

  it('Time left is the remaining time with a true minus sign', () => {
    const p = parts('remaining');
    expect(p.remaining).toBe(`${MINUS}11:20`);
    expect(p.position).toBeNull();
    expect(p.endsAt).toBeNull();
  });

  it('End time alone has only the wall-clock time', () => {
    expect(parts('endsAt')).toEqual({
      position: null,
      total: null,
      remaining: null,
      endsAt: '14:11',
    });
  });

  it('moves the end time with the position', () => {
    expect(parts('endsAt', 0).endsAt).toBe('14:23');
    expect(parts('endsAt', 1412).endsAt).toBe('14:00');
  });

  it('leaves out the end time and the remaining time while the length is unknown', () => {
    expect(parts('combined', 10, 0).endsAt).toBeNull();
    expect(parts('remaining', 10, 0).remaining).toBeNull();
  });

  it('puts the end time at now, never earlier, for a position past the length', () => {
    expect(parts('combined', 6000, 5400).endsAt).toBe('14:00');
    expect(parts('endsAt', 6000, 5400).endsAt).toBe('14:00');
  });

  it('never shows less than zero left past the end', () => {
    expect(parts('remaining', 2000).remaining).toBe(`${MINUS}0:00`);
  });
});
