import { describe, expect, it } from 'vitest';
import {
  browseSignature,
  contentRatings,
  DEFAULT_BROWSE,
  FACETS,
  facetNeedsExtendedRules,
  defaultDescending,
  filterCount,
  filterGroups,
  isSingleChoice,
  WATCH_PROBE_GROUPS,
  LETTERS,
  sortParam,
} from './browse';
import { LibraryMemory } from './libraryMemory';
import { orderedCollections } from './queries';
import { collectionCard, collectionTab } from '../../test/libraryFixtures';

describe('sort', () => {
  it('writes descending as a leading minus', () => {
    expect(sortParam('year', false)).toBe('year');
    expect(sortParam('year', true)).toBe('-year');
  });

  it('starts a title sort A to Z and every other sort with the most', () => {
    expect(defaultDescending('title')).toBe(false);
    for (const sort of ['added_at', 'release_date', 'year', 'rating', 'runtime'] as const) {
      expect(defaultDescending(sort)).toBe(true);
    }
  });
});

describe('filterGroups', () => {
  it('is empty without a value, whatever the facets hold', () => {
    expect(filterGroups({})).toEqual([]);
    expect(filterGroups({ genre: [], decade: [] })).toEqual([]);
  });

  it('makes one group per facet, any of its values matching', () => {
    expect(filterGroups({ genre: ['Action', 'Drama'], decade: ['1990'] })).toEqual([
      {
        match: 'any',
        rules: [
          { field: 'genre', op: 'contains', value: 'Action' },
          { field: 'genre', op: 'contains', value: 'Drama' },
        ],
      },
      { match: 'any', rules: [{ field: 'decade', op: 'is', value: 1990 }] },
    ]);
  });

  // The documented rule vocabulary (catalog-api.md, "Rule fields and operators"): the decade is
  // `decade is <first year>` with a number, and genre is the `genre contains` of the rule schema.
  it('writes each facet as exactly its documented {field, op, value}', () => {
    expect(filterGroups({ genre: ['Crime'] })[0]!.rules).toEqual([
      { field: 'genre', op: 'contains', value: 'Crime' },
    ]);
    expect(filterGroups({ decade: ['2010'] })[0]!.rules).toEqual([
      { field: 'decade', op: 'is', value: 2010 },
    ]);
  });

  it('offers the three rule facets and the content rating, which is a parameter and no rule', () => {
    expect([...FACETS]).toEqual(['genre', 'decade', 'status', 'content_rating']);
    expect(filterGroups({ content_rating: ['PG'] })).toEqual([]);
  });

  // Silo's personalized boolean rules (internal/catalog/query_definition.go: `is` only, boolean).
  it('writes each watch-state choice as exactly its {field, op, value}', () => {
    expect(filterGroups({ status: ['unwatched'] })).toEqual([
      { match: 'any', rules: [{ field: 'watched', op: 'is', value: false }] },
    ]);
    expect(filterGroups({ status: ['watched'] })).toEqual([
      { match: 'any', rules: [{ field: 'watched', op: 'is', value: true }] },
    ]);
    expect(filterGroups({ status: ['in_progress'] })).toEqual([
      { match: 'any', rules: [{ field: 'in_progress', op: 'is', value: true }] },
    ]);
    expect(WATCH_PROBE_GROUPS).toEqual(filterGroups({ status: ['unwatched'] }));
  });

  it('lets the watch state choose one value at a time, and nothing else', () => {
    expect(isSingleChoice('status')).toBe(true);
    expect(isSingleChoice('genre')).toBe(false);
    expect(isSingleChoice('content_rating')).toBe(false);
  });

  it('reads the content ratings for the query parameter, none when empty', () => {
    expect(contentRatings({})).toBeUndefined();
    expect(contentRatings({ content_rating: [] })).toBeUndefined();
    expect(contentRatings({ content_rating: ['PG', 'R'] })).toEqual(['PG', 'R']);
  });

  it('marks the decade as needing the extended rules, and the genre as not', () => {
    expect(facetNeedsExtendedRules('decade')).toBe(true);
    expect(facetNeedsExtendedRules('genre')).toBe(false);
  });
});

describe('filterCount', () => {
  it('counts the facets that hold a value, not the values', () => {
    expect(filterCount({})).toBe(0);
    expect(filterCount({ genre: ['A', 'B', 'C'] })).toBe(1);
    expect(filterCount({ genre: ['A', 'B'], decade: ['1990'] })).toBe(2);
    expect(filterCount({ genre: ['A'], decade: ['1990'], content_rating: ['PG', 'R'] })).toBe(3);
    expect(filterCount({ status: ['watched'] })).toBe(1);
  });
});

describe('letters and the signature', () => {
  it('offers "#" and A to Z', () => {
    expect(LETTERS).toHaveLength(27);
    expect(LETTERS[0]).toBe('#');
    expect(LETTERS[26]).toBe('Z');
  });

  it('tells two selections apart by whatever changes the server answer', () => {
    const base = browseSignature(DEFAULT_BROWSE);
    expect(browseSignature({ ...DEFAULT_BROWSE })).toBe(base);
    expect(browseSignature({ ...DEFAULT_BROWSE, sort: 'year' })).not.toBe(base);
    expect(browseSignature({ ...DEFAULT_BROWSE, descending: true })).not.toBe(base);
    expect(browseSignature({ ...DEFAULT_BROWSE, filters: { genre: ['A'] } })).not.toBe(base);
    expect(browseSignature({ ...DEFAULT_BROWSE, filters: { content_rating: ['PG'] } })).not.toBe(
      base,
    );
  });
});

describe('LibraryMemory', () => {
  it('starts on Recommended with the default Browse choices', () => {
    const memory = new LibraryMemory();
    expect(memory.viewOf('movie')).toBe('recommended');
    expect(memory.libraryOf('movie')).toBeUndefined();
    expect(memory.browseOf('movie', 'lib-1')).toEqual(DEFAULT_BROWSE);
  });

  it('keeps the library and sub-view per tab', () => {
    const memory = new LibraryMemory();
    memory.selectLibrary('movie', 'lib-b');
    memory.selectView('movie', 'collections');
    expect(memory.libraryOf('movie')).toBe('lib-b');
    expect(memory.viewOf('movie')).toBe('collections');
    expect(memory.libraryOf('series')).toBeUndefined();
    expect(memory.viewOf('series')).toBe('recommended');
  });

  it('keeps Browse choices per library, and apart for the two tabs of a mixed library', () => {
    const memory = new LibraryMemory();
    memory.setBrowse('movie', 'lib-1', { ...DEFAULT_BROWSE, sort: 'year' });
    expect(memory.browseOf('movie', 'lib-1').sort).toBe('year');
    expect(memory.browseOf('movie', 'lib-2').sort).toBe('title');
    expect(memory.browseOf('series', 'lib-1').sort).toBe('title');
  });

  it('forgets everything on reset', () => {
    const memory = new LibraryMemory();
    memory.selectLibrary('movie', 'lib-b');
    memory.selectView('series', 'browse');
    memory.setBrowse('movie', 'lib-1', { ...DEFAULT_BROWSE, sort: 'year' });
    memory.indices.set('grid', 4);
    memory.setJumped('grid', true);
    memory.reset();
    expect(memory.libraryOf('movie')).toBeUndefined();
    expect(memory.viewOf('series')).toBe('recommended');
    expect(memory.browseOf('movie', 'lib-1')).toEqual(DEFAULT_BROWSE);
    expect(memory.indices.get('grid')).toBeUndefined();
    expect(memory.isJumped('grid')).toBe(false);
  });

  it('remembers which Browse grids jumped to a letter', () => {
    const memory = new LibraryMemory();
    expect(memory.isJumped('grid')).toBe(false);
    memory.setJumped('grid', true);
    expect(memory.isJumped('grid')).toBe(true);
    expect(memory.isJumped('other')).toBe(false);
    memory.setJumped('grid', false);
    expect(memory.isJumped('grid')).toBe(false);
  });
});

describe('orderedCollections', () => {
  it('lists the groups and the ungrouped cards in the order the server declares, each card once', () => {
    const tab = collectionTab(
      'lib-1',
      [
        { name: 'Studios', order: 3, cards: [collectionCard('c3'), collectionCard('c4')] },
        { name: 'Franchises', order: 1, cards: [collectionCard('c1')] },
      ],
      { order: 2, cards: [collectionCard('c2'), collectionCard('c1')] },
    );
    expect(orderedCollections(tab).map((card) => card.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('lists the ungrouped cards alone when there are no groups', () => {
    const tab = collectionTab('lib-1', [], { order: 0, cards: [collectionCard('c1')] });
    expect(orderedCollections(tab).map((card) => card.id)).toEqual(['c1']);
  });
});
