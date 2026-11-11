import { describe, expect, it } from 'vitest';
import { DetailMemory } from './detailMemory';

describe('DetailMemory', () => {
  it('gives the same memory to the same stack entry and a fresh one to another', () => {
    const memory = new DetailMemory();
    const entry = { name: 'detail', itemId: 's1' };
    const again = { name: 'detail', itemId: 's1' };
    memory.of(entry).rows.set('episodes', 2);
    expect(memory.of(entry).rows.get('episodes')).toBe(2);
    // The same title opened again is a new entry: nothing is remembered from the first visit.
    expect(memory.of(again).rows.get('episodes')).toBeUndefined();
  });
});
