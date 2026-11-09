import { describe, expect, it } from 'vitest';
import { SearchMemory } from './searchMemory';

describe('SearchMemory', () => {
  it('starts empty on "All"', () => {
    const memory = new SearchMemory();
    expect(memory.query).toBe('');
    expect(memory.segment).toBe('all');
    expect(memory.lastKey).toBeUndefined();
  });

  it('forgets the focused cards when the text or the segment changes, not the key', () => {
    const memory = new SearchMemory();
    memory.rememberKey('k');
    memory.indices.set('search', 7);
    memory.setQuery('sag');
    expect(memory.query).toBe('sag');
    expect(memory.indices.get('search')).toBeUndefined();
    memory.indices.set('search', 3);
    memory.setSegment('movies');
    expect(memory.segment).toBe('movies');
    expect(memory.indices.get('search')).toBeUndefined();
    expect(memory.lastKey).toBe('k');
  });

  it('never keeps more than 200 characters', () => {
    const memory = new SearchMemory();
    memory.setQuery('a'.repeat(300));
    expect(memory.query).toHaveLength(200);
  });

  it('is reset by a fresh visit', () => {
    const memory = new SearchMemory();
    memory.setQuery('sag');
    memory.setSegment('series');
    memory.rememberKey('x');
    memory.reset();
    expect([memory.query, memory.segment, memory.lastKey]).toEqual(['', 'all', undefined]);
  });
});
