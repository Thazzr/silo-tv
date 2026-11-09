import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import { GRID_IMAGE_QUERY, ROW_IMAGE_QUERY } from '../../ui/media';
import { GRID_PAGE_SIZE, itemLimitFor, useHomeCapabilities } from '../home/queries';
import {
  browseGroups,
  contentRatings,
  filterGroups,
  sortParam,
  type BrowseSelection,
} from './browse';
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
  const capabilities = useHomeCapabilities();
  // A failed capabilities read means "no limit": the rows are cut to 20 cards on the client.
  const limit = itemLimitFor(capabilities.data?.section_item_limit_max);
  return useQuery({
    queryKey: ['library', 'sections', baseUrl, profileId, libraryId, limit ?? 0],
    enabled: !capabilities.isPending,
    queryFn: async () => {
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

/** The pages of the Browse grid of a library, 40 titles at a time, following the server's cursor. */
export function useBrowsePages(libraryId: string, kind: LibraryKind, selection: BrowseSelection) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const groups = browseGroups(selection.filters, selection.letter);
  const { letter } = selection;
  const groupsJson = groups.length > 0 ? JSON.stringify(groups) : undefined;
  const sort = sortParam(selection.sort, selection.descending);
  const ratings = contentRatings(selection.filters);
  return useInfiniteQuery({
    queryKey: [
      'library',
      'browse',
      baseUrl,
      profileId,
      libraryId,
      kind,
      sort,
      groupsJson ?? '',
      ratings ?? [],
      letter ?? '',
    ],
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
            // "#" is a rule group above; a real letter is the server's own title prefix.
            name_prefix: letter && letter !== '#' ? letter : undefined,
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
 * rule and the title prefix rules behind "#". A server that cannot say counts as "no": an older
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
 * The letters that have titles under the current filters, for the rail. The answer does not
 * depend on the letter or the sort. It takes rule groups only, so it does not reflect the content
 * rating (a plain `content_rating` parameter): a letter can be lit with no title left under it. A server that cannot answer leaves every letter usable.
 */
export function useLetters(libraryId: string, kind: LibraryKind, selection: BrowseSelection) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const groups = filterGroups(selection.filters);
  return useQuery({
    queryKey: ['library', 'letters', baseUrl, profileId, libraryId, kind, JSON.stringify(groups)],
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.POST('/api/v2/catalog/letters', {
        params: { header: { 'X-Profile-Id': profileId } },
        body: { library_id: libraryId, type: kind, match: 'all', groups },
      });
      if (!data) throw toApiError(error, response);
      return new Set(data.letters.filter((entry) => entry.count > 0).map((entry) => entry.letter));
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
