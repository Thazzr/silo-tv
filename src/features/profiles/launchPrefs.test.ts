import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../test/renderFlow';
import {
  LAUNCH_MODES,
  ProfileLaunchPrefs,
  shouldShowPicker,
  type LaunchRecord,
} from './launchPrefs';

const HOUR = 3_600_000;
const NOW = 1_000_000_000_000;
const ORIGIN = 'https://silo.example.test';

function record(patch: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    mode: 'every',
    lastProfileId: 'p1',
    lastProfileHasPin: false,
    lastUsedAt: NOW,
    offered: true,
    ...patch,
  };
}

describe('shouldShowPicker', () => {
  it('Automatic reopens the last profile, however long ago it was used', () => {
    expect(shouldShowPicker(record({ mode: 'automatic', lastUsedAt: NOW - 500 * HOUR }), NOW)).toBe(
      false,
    );
  });

  it('Every time always shows the picker', () => {
    expect(shouldShowPicker(record({ mode: 'every', lastUsedAt: NOW }), NOW)).toBe(true);
  });

  it.each([
    ['hour', HOUR],
    ['halfday', 12 * HOUR],
  ] as const)('%s: reopens at exactly the limit and asks just past it', (mode, limit) => {
    expect(shouldShowPicker(record({ mode, lastUsedAt: NOW - limit + 1 }), NOW)).toBe(false);
    expect(shouldShowPicker(record({ mode, lastUsedAt: NOW - limit }), NOW)).toBe(false);
    expect(shouldShowPicker(record({ mode, lastUsedAt: NOW - limit - 1 }), NOW)).toBe(true);
  });

  it('a timed mode asks when there is no stamp or the clock reads earlier than the last use', () => {
    expect(shouldShowPicker(record({ mode: 'hour', lastUsedAt: null }), NOW)).toBe(true);
    expect(shouldShowPicker(record({ mode: 'hour', lastUsedAt: NOW + 1 }), NOW)).toBe(true);
  });

  it('shows the picker when no profile was chosen yet', () => {
    expect(shouldShowPicker(record({ mode: 'automatic', lastProfileId: null }), NOW)).toBe(true);
  });

  it.each(LAUNCH_MODES)('never opens a PIN profile by itself in mode %s', (mode) => {
    expect(shouldShowPicker(record({ mode, lastProfileHasPin: true, lastUsedAt: NOW }), NOW)).toBe(
      true,
    );
  });
});

describe('ProfileLaunchPrefs', () => {
  it('starts on Every time, not offered, without a profile', () => {
    const prefs = new ProfileLaunchPrefs(memoryStorage(), () => NOW);
    expect(prefs.get(ORIGIN)).toEqual({
      mode: 'every',
      lastProfileId: null,
      lastProfileHasPin: false,
      lastUsedAt: null,
      offered: false,
    });
  });

  it('keeps one record per server and survives a new instance on the same storage', () => {
    const storage = memoryStorage();
    const prefs = new ProfileLaunchPrefs(storage, () => NOW);
    prefs.setMode(ORIGIN, 'hour');
    prefs.recordPick(ORIGIN, { id: 'p9', has_pin: false });
    const again = new ProfileLaunchPrefs(storage, () => NOW);
    expect(again.get(ORIGIN)).toMatchObject({
      mode: 'hour',
      lastProfileId: 'p9',
      lastUsedAt: NOW,
    });
    expect(again.get('https://other.example.test').mode).toBe('every');
  });

  it('setMode answers the offer, and the cached record changes identity only on a change', () => {
    const prefs = new ProfileLaunchPrefs(memoryStorage(), () => NOW);
    const before = prefs.get(ORIGIN);
    expect(prefs.get(ORIGIN)).toBe(before);
    prefs.setMode(ORIGIN, 'automatic');
    expect(prefs.get(ORIGIN)).not.toBe(before);
    expect(prefs.get(ORIGIN)).toMatchObject({ mode: 'automatic', offered: true });
  });

  it('touch stamps the use only after a profile was chosen', () => {
    let clock = NOW;
    const prefs = new ProfileLaunchPrefs(memoryStorage(), () => clock);
    prefs.touch(ORIGIN);
    expect(prefs.get(ORIGIN).lastUsedAt).toBeNull();
    prefs.recordPick(ORIGIN, { id: 'p1', has_pin: false });
    clock = NOW + 5 * 60_000;
    prefs.touch(ORIGIN);
    expect(prefs.get(ORIGIN).lastUsedAt).toBe(clock);
  });

  it('notifies subscribers, and clear forgets the server', () => {
    const storage = memoryStorage();
    const prefs = new ProfileLaunchPrefs(storage, () => NOW);
    let calls = 0;
    const unsubscribe = prefs.subscribe(() => (calls += 1));
    prefs.setMode(ORIGIN, 'halfday');
    expect(calls).toBe(1);
    prefs.clear(ORIGIN);
    expect(calls).toBe(2);
    expect(prefs.get(ORIGIN).mode).toBe('every');
    expect(new ProfileLaunchPrefs(storage).get(ORIGIN).mode).toBe('every');
    unsubscribe();
    prefs.setMode(ORIGIN, 'automatic');
    expect(calls).toBe(2);
  });

  it('reads damaged or unknown storage as a new TV', () => {
    const storage = memoryStorage();
    storage.set(`silo-tv.profileLaunch.v1.${ORIGIN}`, '{not json');
    expect(new ProfileLaunchPrefs(storage).get(ORIGIN).mode).toBe('every');
    storage.set(`silo-tv.profileLaunch.v1.${ORIGIN}`, JSON.stringify({ v: 2, record: {} }));
    expect(new ProfileLaunchPrefs(storage).get(ORIGIN).lastProfileId).toBeNull();
  });

  it('shouldShowPicker uses its own clock', () => {
    let clock = NOW;
    const prefs = new ProfileLaunchPrefs(memoryStorage(), () => clock);
    prefs.setMode(ORIGIN, 'hour');
    prefs.recordPick(ORIGIN, { id: 'p1', has_pin: false });
    expect(prefs.shouldShowPicker(ORIGIN)).toBe(false);
    clock = NOW + HOUR + 1;
    expect(prefs.shouldShowPicker(ORIGIN)).toBe(true);
  });
});
