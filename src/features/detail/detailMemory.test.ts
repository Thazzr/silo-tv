import { describe, expect, it } from 'vitest';
import { DetailMemory } from './detailMemory';

describe('DetailMemory', () => {
  it('gives the same memory to the same stack entry and a fresh one to another', () => {
    const memory = new DetailMemory();
    const entry = { name: 'detail', itemId: 's1' };
    const again = { name: 'detail', itemId: 's1' };
    memory.of(entry).pickSeason(3);
    memory.of(entry).rows.set('season-3', 2);
    expect(memory.of(entry).season).toBe(3);
    expect(memory.of(entry).rows.get('season-3')).toBe(2);
    // The same title opened again is a new entry: nothing is remembered from the first visit.
    expect(memory.of(again).season).toBeUndefined();
    expect(memory.of(again).rows.get('season-3')).toBeUndefined();
  });
});
