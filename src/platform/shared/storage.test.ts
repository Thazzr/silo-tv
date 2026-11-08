import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyValueStore } from './storage';

afterEach(() => localStorage.clear());

function memoryBacking(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('createKeyValueStore', () => {
  it('reads, writes and removes through the backing storage', () => {
    const store = createKeyValueStore(() => localStorage);
    expect(store.get('k')).toBeNull();
    store.set('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(store.get('k')).toBe('v');
    store.remove('k');
    expect(store.get('k')).toBeNull();
  });

  it('tolerates a localStorage whose methods throw', () => {
    const backing = memoryBacking();
    const boom = () => {
      throw new Error('blocked');
    };
    vi.spyOn(backing, 'getItem').mockImplementation(boom);
    vi.spyOn(backing, 'setItem').mockImplementation(boom);
    vi.spyOn(backing, 'removeItem').mockImplementation(boom);
    const store = createKeyValueStore(() => backing);
    expect(store.get('k')).toBeNull();
    expect(() => store.set('k', 'v')).not.toThrow();
    expect(() => store.remove('k')).not.toThrow();
  });

  it('tolerates a backing storage that cannot even be reached', () => {
    const store = createKeyValueStore(() => {
      throw new Error('SecurityError');
    });
    expect(store.get('k')).toBeNull();
    expect(() => store.set('k', 'v')).not.toThrow();
    expect(() => store.remove('k')).not.toThrow();
  });

  it('treats a missing backing storage as empty', () => {
    const store = createKeyValueStore(() => null);
    expect(store.get('k')).toBeNull();
    expect(() => store.set('k', 'v')).not.toThrow();
  });
});
