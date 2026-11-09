import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../platform';
import { getResumeRewind, setResumeRewind } from './resumeRewind';

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

describe('resume rewind setting', () => {
  it('is 7 s when nothing is stored', () => {
    expect(getResumeRewind(store())).toBe(7);
  });

  it('reads a stored value in range, 0 (off) and the limits included', () => {
    expect(getResumeRewind(store('15'))).toBe(15);
    expect(getResumeRewind(store('0'))).toBe(0);
    expect(getResumeRewind(store('30'))).toBe(30);
  });

  it.each(['-1', '31', '7.5', 'abc', '', '1e1', ' 7'])('falls back to 7 s for %j', (raw) => {
    expect(getResumeRewind(store(raw))).toBe(7);
  });

  it('persists a set value and reads it back', () => {
    const s = store();
    setResumeRewind(20, s);
    expect(s.raw()).toBe('20');
    expect(getResumeRewind(s)).toBe(20);
  });

  it('refuses to store a value the contract does not allow', () => {
    const s = store('10');
    setResumeRewind(31, s);
    setResumeRewind(2.5, s);
    setResumeRewind(-3, s);
    expect(getResumeRewind(s)).toBe(10);
  });
});
