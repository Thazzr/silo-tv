import { useInfiniteQuery, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import { GRID_IMAGE_QUERY, ROW_IMAGE_QUERY } from '../../ui/media';
import { GRID_PAGE_SIZE, useHomeCapabilities, useSectionLimits } from '../home/queries';
import {
  contentRatings,
  filterGroups,
  sortParam,
  WATCH_PROBE_GROUPS,
  type BrowseSelection,
} from './browse';
import type { LetterIndex } from './letterIndex';
import type { TabKind } from './libraryMemory';

export type UserLibrary = components['schemas']['UserLibrary'];
export type CatalogItem = components['schemas']['CatalogItem'];
export type LibrarySection = components['schemas']['Section'];
export type CollectionCard = components['schemas']['LibraryCollectionCard'];
export type CatalogFilters = components['schemas']['CatalogFilters'];

// Library types Silo stores as free text, with the spellings its own web client accepts.
// Mixed libraries hold movies and series, so they count for both tabs.
const MOVIE_TYPES = ['movie', 'movies'];
const SERIES_TYPES = ['series', 'tv', 'show', 'tvshows'];
const MIXED_TYPES = ['mixed'];

/** What a library tab lists. */
export type LibraryKind = TabKind;

const KIND_TYPES: Record<LibraryKind, Set<string>> = {
  movie: new Set([...MOVIE_TYPES, ...MIXED_TYPES]),
  series: new Set([...SERIES_TYPES, ...MIXED_TYPES]),
};

const normalised = (library: UserLibrary) => library.type.trim().toLowerCase();

/** The libraries a tab can show, in the server's order; a mixed library counts for both tabs. */
export function librariesOfKind(
  libraries: readonly UserLibrary[],
  kind: LibraryKind,
): UserLibrary[] {
  return libraries.filter((library) => KIND_TYPES[kind].has(normalised(library)));
}

/** A mixed library holds both kinds, so its tabs have to cut their own kind out of its lists. */
export function isMixed(library: UserLibrary): boolean {
  return MIXED_TYPES.includes(normalised(library));
}

/** The user's libraries. */
export function useLibraries() {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['libraries', baseUrl, profileId],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/user/libraries');
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
}

/** The sections of a library's Recommended view, each with its first cards. */
export function useLibrarySections(libraryId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  // Started here so a later request can use the limit; the rows never wait for it.
  useHomeCapabilities();
  const limits = useSectionLimits();
  return useQuery({
    queryKey: ['library', 'sections', baseUrl, profileId, libraryId],
    queryFn: async () => {
      const limit = limits().sectionLimit;
      const { data, error, response } = await client.GET('/api/v2/library/{id}/sections', {
        params: {
          header: { 'X-Profile-Id': profileId },
          path: { id: libraryId },
          query: { item_limit: limit, ...ROW_IMAGE_QUERY },
        },
      });
      if (!data) throw toApiError(error, response);
      return data.sections;
    },
  });
}

/** What a Browse read of a library depends on, besides the page: the request parts and the cache key. */
function browseRead(libraryId: string, kind: LibraryKind, selection: BrowseSelection) {
  const groups = filterGroups(selection.filters);
  const groupsJson = groups.length > 0 ? JSON.stringify(groups) : undefined;
  const sort = sortParam(selection.sort, selection.descending);
  const ratings = contentRatings(selection.filters);
  return {
    groupsJson,
    sort,
    ratings,
    keyParts: [libraryId, kind, sort, groupsJson ?? '', ratings ?? []],
  };
}

/** The pages of the Browse grid of a library, 40 titles at a time, following the server's cursor. */
export function useBrowsePages(libraryId: string, kind: LibraryKind, selection: BrowseSelection) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const { groupsJson, sort, ratings, keyParts } = browseRead(libraryId, kind, selection);
  return useInfiniteQuery({
    queryKey: ['library', 'browse', baseUrl, profileId, ...keyParts],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: {
            library_id: libraryId,
            type: kind,
            sort,
            match: 'all',
            groups: groupsJson,
            content_rating: ratings,
            limit: GRID_PAGE_SIZE,
            cursor: pageParam,
            ...GRID_IMAGE_QUERY,
          },
        },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
    getNextPageParam: (last) => (last.page?.has_more ? last.page.next_cursor : undefined),
  });
}

/**
 * Pages of the Browse list read at their own place, for a grid that jumped far down: page `n`
 * holds the titles from position `n * GRID_PAGE_SIZE` on, read with the catalog's `seek` instead
 * of every page before it. `windowCursor` is the `window_cursor` of the list's first read: sent as
 * `cursor` with each `seek`, it pins the pages to the list as that read saw it, so titles added
 * meanwhile do not shift them (silo web's `useCatalogWindow` does the same with page 0's cursor).
 * Nothing is read until it is known, and a new one (the first read repeated) keys new pages. The result maps each loaded page to its titles. A server returns a
 * full page except at the end of the list, so a page's titles sit at consecutive positions.
 */
export function useBrowseWindow(
  libraryId: string,
  kind: LibraryKind,
  selection: BrowseSelection,
  pageIndices: readonly number[],
  windowCursor: string | undefined,
): { pages: Map<number, CatalogItem[]>; version: string } {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const { groupsJson, sort, ratings, keyParts } = browseRead(libraryId, kind, selection);
  const results = useQueries({
    queries: pageIndices.map((page) => ({
      queryKey: ['library', 'browse-window', baseUrl, profileId, ...keyParts, windowCursor, page],
      enabled: windowCursor !== undefined,
      queryFn: async () => {
        const { data, error, response } = await client.GET('/api/v2/catalog', {
          params: {
            header: { 'X-Profile-Id': profileId },
            query: {
              library_id: libraryId,
              type: kind,
              sort,
              match: 'all',
              groups: groupsJson,
              content_rating: ratings,
              limit: GRID_PAGE_SIZE,
              cursor: windowCursor,
              seek: page * GRID_PAGE_SIZE,
              skip_total: true,
              ...GRID_IMAGE_QUERY,
            },
          },
        });
        if (!data) throw toApiError(error, response);
        return data.items;
      },
    })),
  });
  const pages = new Map<number, CatalogItem[]>();
  results.forEach((result, i) => {
    if (result.data) pages.set(pageIndices[i]!, result.data);
  });
  // Changes when a page arrives or is read again, so a caller can memoise what it builds from it.
  return { pages, version: results.map((result) => result.dataUpdatedAt).join(',') };
}

/**
 * What the server's search says it can do (`extended_query_rules`, `box_sets`, ...). Read once per
 * server and session, because the answer only changes with a server update; a read that fails
 * leaves every capability "off".
 */
export function useSearchCapabilities() {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['library', 'search-capabilities', baseUrl, profileId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/search/capabilities', {
        params: { header: { 'X-Profile-Id': profileId } },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/**
 * Whether the server accepts the extended rule vocabulary (`extended_query_rules`): the decade
 * rule. A server that cannot say counts as "no": an older
 * one answers those rules with 422.
 */
export function useExtendedRules(): boolean {
  return useSearchCapabilities().data?.extended_query_rules === true;
}

/** Whether the server has box sets (`box_sets`); a server that cannot say counts as "no". */
export function useBoxSetsAvailable(): boolean {
  return useSearchCapabilities().data?.box_sets === true;
}

/** The facet values (genres, ratings, …) the library's titles have. */
export function useCatalogFilters(libraryId: string, kind: LibraryKind) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['library', 'filters', baseUrl, profileId, libraryId, kind],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/filters', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: { library_id: libraryId, type: kind },
        },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/**
 * Whether the server accepts the watch-state rules (`watched`, `in_progress`). Silo does not
 * advertise them, so the first Browse of a server and profile asks for one title under
 * `watched is false`: a 2xx means yes, anything else (a 422 from an older server, a failure) means
 * no, and the Status section stays out without any message. The answer is kept for the session.
 */
export function useWatchRules(libraryId: string, kind: LibraryKind): boolean {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const probe = useQuery({
    queryKey: ['library', 'watch-rules', baseUrl, profileId],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: {
            library_id: libraryId,
            type: kind,
            match: 'all',
            groups: JSON.stringify(WATCH_PROBE_GROUPS),
            limit: 1,
            skip_total: true,
          },
        },
      });
      if (!data) throw toApiError(error, response);
      return true;
    },
  });
  return probe.data === true;
}

/**
 * The letter index of the list under the current sort direction and filters, for the rail: the
 * letters that have titles, where each block of titles starts, and the list's length. It only
 * exists for a title-ordered list, so it is not read for another sort. It takes rule groups only,
 * so it does not reflect the content rating (a plain `content_rating` parameter): a letter can be
 * lit with no title left under it. A server that cannot answer leaves no index, and so no rail.
 */
export function useLetters(libraryId: string, kind: LibraryKind, selection: BrowseSelection) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const groups = filterGroups(selection.filters);
  const order = selection.descending ? 'desc' : 'asc';
  return useQuery({
    queryKey: [
      'library',
      'letters',
      baseUrl,
      profileId,
      libraryId,
      kind,
      JSON.stringify(groups),
      order,
    ],
    enabled: selection.sort === 'title',
    retry: false,
    queryFn: async (): Promise<LetterIndex> => {
      const { data, error, response } = await client.POST('/api/v2/catalog/letters', {
        params: { header: { 'X-Profile-Id': profileId } },
        body: { library_id: libraryId, type: kind, match: 'all', groups, order },
      });
      if (!data) throw toApiError(error, response);
      return {
        lit: new Set(data.letters.filter((entry) => entry.count > 0).map((entry) => entry.letter)),
        runs: data.runs,
        total: data.total,
      };
    },
  });
}

/** Every collection once, in the order of the groups, with the ungrouped ones at their place. */
export function orderedCollections(
  data: components['schemas']['LibraryCollectionTab'],
): CollectionCard[] {
  const parts = [
    ...data.groups.map((group) => ({ order: group.sort_order, cards: group.collections })),
    ...(data.ungrouped
      ? [{ order: data.ungrouped.sort_order, cards: data.ungrouped.collections }]
      : []),
  ].sort((a, b) => a.order - b.order);
  const seen = new Set<string>();
  const cards: CollectionCard[] = [];
  for (const card of parts.flatMap((part) => part.cards)) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  return cards;
}

/** The collections of a library, and the descriptions the cards lack. */
export function useLibraryCollections(libraryId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['library', 'collections', baseUrl, profileId, libraryId],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/library/{id}/collections', {
        params: { header: { 'X-Profile-Id': profileId }, path: { id: libraryId } },
      });
      if (!data) throw toApiError(error, response);
      return {
        cards: orderedCollections(data),
        descriptions: new Map(data.collections.map((c) => [c.id, c.description])),
      };
    },
  });
}

/** The pages of the items of one collection, in the server's order. */
export function useCollectionPages(libraryId: string, collectionId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useInfiniteQuery({
    queryKey: ['library', 'collection-items', baseUrl, profileId, libraryId, collectionId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error, response } = await client.GET(
        '/api/v2/library/{id}/collections/{collection_id}/items',
        {
          params: {
            header: { 'X-Profile-Id': profileId },
            path: { id: libraryId, collection_id: collectionId },
            query: { limit: GRID_PAGE_SIZE, cursor: pageParam },
          },
        },
      );
      if (!data) throw toApiError(error, response);
      return data;
    },
    getNextPageParam: (last) => (last.page?.has_more ? last.page.next_cursor : undefined),
  });
}

/**
 * Ends the session on the server; the local session is cleared whatever the answer was. The
 * flow listens for the session's `signedOut` event and returns to the sign-in screen.
 */
export function useSignOut() {
  const { client, session } = useSilo();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await client.POST('/api/v2/auth/logout');
      if (!response.ok) throw toApiError(error, response);
    },
    onSettled: () => {
      session.signOut();
    },
  });
}
