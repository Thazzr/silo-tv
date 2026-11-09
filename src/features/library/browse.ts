// The pure rules of the Browse view: which sorts exist, how a filter selection becomes the rule
// groups the catalog takes, and what the Filter pill counts.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';

type Group = components['schemas']['CatalogQueryGroup'];
type Rule = components['schemas']['CatalogQueryRule'];

/** The sort fields Browse offers; the server's names, as `sort=field` or `sort=-field` takes them. */
export const SORT_KEYS = [
  'title',
  'added_at',
  'release_date',
  'year',
  'rating',
  'runtime',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, MessageKey> = {
  title: 'library.sort.title',
  added_at: 'library.sort.addedAt',
  release_date: 'library.sort.releaseDate',
  year: 'library.sort.year',
  rating: 'library.sort.rating',
  runtime: 'library.sort.runtime',
};

/** A title list starts A to Z; every other sort starts with the most (newest, best, longest). */
export function defaultDescending(sort: SortKey): boolean {
  return sort !== 'title';
}

/** The `sort` query value: the field, with a leading minus for descending. */
export function sortParam(sort: SortKey, descending: boolean): string {
  return descending ? `-${sort}` : sort;
}

/**
 * The filter facets of the panel, in the order they are listed. Only rules that Silo documents
 * are used (catalog-api.md, "Rule fields and operators", and the `genre` / `contains` example of
 * the rule schema); the watch state, content rating and resolution have no documented rule field.
 */
export const FACETS = ['genre', 'decade'] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Record<Facet, MessageKey> = {
  genre: 'library.filter.genre',
  decade: 'library.filter.decade',
};

/** Facets and letters that need the server's extended rule vocabulary (`extended_query_rules`). */
export function facetNeedsExtendedRules(facet: Facet): boolean {
  return facet === 'decade';
}

/** The chosen values of each facet; an absent or empty facet filters nothing. */
export type FilterSelection = Partial<Record<Facet, string[]>>;

/** The decades on offer, as their first year; the catalog has nothing worth filtering before 1950. */
export const DECADES = ['2020', '2010', '2000', '1990', '1980', '1970', '1960', '1950'] as const;

/** Facets whose values exclude each other (none now). */
export function isSingleChoice(facet: Facet): boolean {
  void facet;
  return false;
}

function ruleFor(facet: Facet, value: string): Rule {
  switch (facet) {
    case 'genre':
      return { field: 'genre', op: 'contains', value };
    case 'decade':
      // The decade's first year, as a number: `1990` matches 1990 to 1999.
      return { field: 'decade', op: 'is', value: Number(value) };
  }
}

/** One group per facet with a value, any of its values matching; the groups all have to match. */
export function filterGroups(filters: FilterSelection): Group[] {
  const groups: Group[] = [];
  for (const facet of FACETS) {
    const values = filters[facet];
    if (!values || values.length === 0) continue;
    groups.push({ match: 'any', rules: values.map((value) => ruleFor(facet, value)) });
  }
  return groups;
}

/** Titles that start with a digit: the server has no `name_prefix` for "#", so the rules say it. */
const NUMBER_GROUP: Group = {
  match: 'any',
  rules: Array.from({ length: 10 }, (_, digit) => ({
    field: 'title',
    op: 'begins_with',
    value: String(digit),
  })),
};

/** The rule groups of a Browse read: the filters, and "#" as the group of numbered titles. */
export function browseGroups(filters: FilterSelection, letter: string | null): Group[] {
  const groups = filterGroups(filters);
  return letter === '#' ? [...groups, NUMBER_GROUP] : groups;
}

/** The number the Filter pill shows: facets that hold a value. */
export function filterCount(filters: FilterSelection): number {
  return FACETS.filter((facet) => (filters[facet]?.length ?? 0) > 0).length;
}

/** A letter on the rail: "#" and A to Z. */
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const;

/** What Browse remembers of a library for the session. */
export interface BrowseSelection {
  sort: SortKey;
  descending: boolean;
  filters: FilterSelection;
  /** The rail's letter; null shows every title. */
  letter: string | null;
}

export const DEFAULT_BROWSE: BrowseSelection = {
  sort: 'title',
  descending: false,
  filters: {},
  letter: null,
};

/** The parts of a selection that change what the server answers, as one string. */
export function browseSignature(selection: BrowseSelection): string {
  return JSON.stringify([
    selection.sort,
    selection.descending,
    selection.filters,
    selection.letter,
  ]);
}
