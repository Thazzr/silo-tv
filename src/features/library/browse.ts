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
 * The facets that are rule groups: genre and decade (catalog-api.md, "Rule fields and
 * operators", and the `genre` / `contains` example of the rule schema) and the watch state. The
 * watch rules are in Silo's rule vocabulary but not advertised to clients, so the app probes them
 * (`useWatchRules`).
 */
export const RULE_FACETS = ['genre', 'decade', 'status'] as const;
export type RuleFacet = (typeof RULE_FACETS)[number];

/**
 * The filter facets of the panel, in the order they are listed. The content rating is not a rule
 * group but the plain `content_rating` query parameter of `GET /catalog` (repeated per value).
 */
export const FACETS = [...RULE_FACETS, 'content_rating'] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Record<Facet, MessageKey> = {
  genre: 'library.filter.genre',
  decade: 'library.filter.decade',
  status: 'library.filter.status',
  content_rating: 'library.filter.contentRating',
};

/** Facets that need the server's extended rule vocabulary (`extended_query_rules`). */
export function facetNeedsExtendedRules(facet: Facet): boolean {
  return facet === 'decade';
}

/** The chosen values of each facet; an absent or empty facet filters nothing. */
export type FilterSelection = Partial<Record<Facet, string[]>>;

/** The decades on offer, as their first year; the catalog has nothing worth filtering before 1950. */
export const DECADES = ['2020', '2010', '2000', '1990', '1980', '1970', '1960', '1950'] as const;

/** The watch-state choices, in the order they are listed ("Alle" is the absence of a choice). */
export const STATUS_VALUES = ['unwatched', 'watched', 'in_progress'] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];

export const STATUS_LABELS: Record<StatusValue, MessageKey> = {
  unwatched: 'library.status.unwatched',
  watched: 'library.status.watched',
  in_progress: 'library.status.inProgress',
};

/** Facets whose values exclude each other: the watch state. */
export function isSingleChoice(facet: Facet): boolean {
  return facet === 'status';
}

function ruleFor(facet: RuleFacet, value: string): Rule {
  switch (facet) {
    case 'genre':
      return { field: 'genre', op: 'contains', value };
    case 'decade':
      // The decade's first year, as a number: `1990` matches 1990 to 1999.
      return { field: 'decade', op: 'is', value: Number(value) };
    case 'status':
      // Silo's personalized boolean rules, operator `is` only: `watched` false is "not completed",
      // `in_progress` true is "has a resume position" (silo-server internal/catalog/
      // query_definition.go:61 and :64, query_builder.go:965 and :1022; its web client builds the
      // same rules in CollectionGuidedRulesEditor.tsx).
      if (value === 'in_progress') return { field: 'in_progress', op: 'is', value: true };
      return { field: 'watched', op: 'is', value: value === 'watched' };
  }
}

/** One group per facet with a value, any of its values matching; the groups all have to match. */
export function filterGroups(filters: FilterSelection): Group[] {
  const groups: Group[] = [];
  for (const facet of RULE_FACETS) {
    const values = filters[facet];
    if (!values || values.length === 0) continue;
    groups.push({ match: 'any', rules: values.map((value) => ruleFor(facet, value)) });
  }
  return groups;
}

/** The rule groups of the watch-rule probe: `watched is false`, built like a Browse read builds it. */
export const WATCH_PROBE_GROUPS: Group[] = filterGroups({ status: ['unwatched'] });

/** The ratings for the `content_rating` query parameter; undefined sends no parameter. */
export function contentRatings(filters: FilterSelection): string[] | undefined {
  const values = filters.content_rating;
  return values && values.length > 0 ? values : undefined;
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
}

export const DEFAULT_BROWSE: BrowseSelection = {
  sort: 'title',
  descending: false,
  filters: {},
};

/** The parts of a selection that change what the server answers, as one string. */
export function browseSignature(selection: BrowseSelection): string {
  return JSON.stringify([selection.sort, selection.descending, selection.filters]);
}
