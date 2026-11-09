import { useEffect, useMemo } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { SiloApiError } from '../../api/problem';
import { useSilo } from '../../app/SiloContext';
import { GRID_IMAGE_QUERY } from '../../ui/media';
import { GRID_PAGE_SIZE } from '../home/queries';
import { useSearchCapabilities } from '../library/queries';
import {
  BOX_SET_LIMIT,
  peopleScope,
  PEOPLE_LIMIT,
  SEARCH_DELAY_MS,
  titleType,
  wantsBoxSets,
  wantsPeople,
  type Segment,
} from './info';

/**
 * Waits until typing has rested, as the first step of a search request. The wait is part of the
 * request, so a new keystroke (a new query key) cancels it like it cancels a request in flight:
 * nothing is sent for text that was typed over within 300 ms.
 */
export function quietPeriod(signal: AbortSignal, ms: number = SEARCH_DELAY_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('The search was replaced', 'AbortError'));
    if (signal.aborted) {
      aborted();
      return;
    }
    const done = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const id = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(id);
      aborted();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The pages of the titles that match `query` in the segment's scope, 40 at a time, ranked by
 * relevance (the server's default for a text search). It waits for the capabilities, which decide
 * the scope, and keeps the previous results on screen until the new ones arrive. A cursor the
 * server no longer knows (`invalid_cursor`) restarts the search from the first page.
 */
export function useSearchTitles(query: string, segment: Segment) {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  const profileId = session.get()?.profileId ?? '';
  const capabilities = useSearchCapabilities();
  const type = titleType(segment, capabilities.data);
  const queryKey = useMemo(
    () => ['search', 'titles', baseUrl, profileId, query, type],
    [baseUrl, profileId, query, type],
  );
  const result = useInfiniteQuery({
    queryKey,
    enabled: query !== '' && !capabilities.isPending,
    initialPageParam: undefined as string | undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      if (pageParam === undefined) await quietPeriod(signal);
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: { q: query, type, limit: GRID_PAGE_SIZE, cursor: pageParam, ...GRID_IMAGE_QUERY },
        },
        signal,
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
    getNextPageParam: (last) => (last.page?.has_more ? last.page.next_cursor : undefined),
  });

  const { error } = result;
  const staleCursor = error instanceof SiloApiError && error.code === 'invalid_cursor';
  useEffect(() => {
    // The ranking this cursor belonged to is gone: forget the pages and read the first one again.
    if (staleCursor) void queryClient.resetQueries({ queryKey, exact: true });
  }, [staleCursor, queryKey, queryClient]);
  return { ...result, capabilitiesPending: capabilities.isPending };
}

/** The box sets whose name matches; only for the segments and servers that offer them. A failed read is no box sets. */
export function useSearchBoxSets(query: string, segment: Segment) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const capabilities = useSearchCapabilities();
  const wanted = query !== '' && wantsBoxSets(segment, capabilities.data);
  const result = useQuery({
    queryKey: ['search', 'boxsets', baseUrl, profileId, query],
    enabled: wanted,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      await quietPeriod(signal);
      const { data, error, response } = await client.GET('/api/v2/catalog/box-sets', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: { q: query, limit: BOX_SET_LIMIT },
        },
        signal,
      });
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
  return { items: wanted ? (result.data ?? []) : [], loading: wanted && result.isFetching };
}

/** The people whose name matches, scoped like the titles' "All"; only where the server offers them. A failed read is no people. */
export function useSearchPeople(query: string, segment: Segment) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const capabilities = useSearchCapabilities();
  const wanted = query !== '' && wantsPeople(segment, capabilities.data);
  const scope = peopleScope(capabilities.data);
  const result = useQuery({
    queryKey: ['search', 'people', baseUrl, profileId, query, scope],
    enabled: wanted,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      await quietPeriod(signal);
      const { data, error, response } = await client.GET('/api/v2/catalog/people', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: {
            q: query,
            limit: PEOPLE_LIMIT,
            media_scope: scope as 'video' | 'video_with_episodes',
          },
        },
        signal,
      });
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
  return { items: wanted ? (result.data ?? []) : [], loading: wanted && result.isFetching };
}
