import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import { GRID_IMAGE_QUERY, ROW_IMAGE_QUERY } from '../../ui/media';

export type HomeSection = components['schemas']['Section'];
export type HomeItem = components['schemas']['CatalogItem'];
export type DismissSurface = 'continue_watching' | 'next_up';

/** A Home row shows at most this many cards; "Explore all" opens the rest. */
export const ROW_ITEM_LIMIT = 20;
/** Cards a grid page asks for. */
export const GRID_PAGE_SIZE = 40;

/**
 * The item limit a request may carry: the row maximum, cut to what the server accepts, or none
 * when the server does not say (an older server rejects the parameter).
 */
export function itemLimitFor(serverMax: number | undefined): number | undefined {
  if (!serverMax || serverMax < 1) return undefined;
  return Math.min(ROW_ITEM_LIMIT, serverMax);
}

/** What the server accepts as `item_limit`, for the list of sections and for one section. */
export function useHomeCapabilities() {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['home', 'capabilities', baseUrl],
    // Read once per server and session: the answer only changes with a server update.
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/home/capabilities', {
        params: { header: { 'X-Profile-Id': profileId } },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/** The home sections in server order, each with its first cards, once the capabilities settled. */
export function useHomeSections() {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  const capabilities = useHomeCapabilities();
  // A failed capabilities read means "no limit": the rows are cut to 20 cards on the client.
  const sectionLimit = itemLimitFor(capabilities.data?.section_item_limit_max);
  const rowLimit = itemLimitFor(capabilities.data?.row_item_limit_max);

  const query = useQuery({
    queryKey: ['home', 'sections', baseUrl, profileId, sectionLimit ?? 0],
    enabled: !capabilities.isPending,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/home/sections', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: { item_limit: sectionLimit, ...ROW_IMAGE_QUERY },
        },
      });
      if (!data) throw toApiError(error, response);
      return data.sections;
    },
  });
  return { query, rowLimit, profileId };
}

/** Reads one section again (after a removal, or "Try again"); throws when the read fails. */
export function useSectionReader(rowLimit: number | undefined) {
  const { client, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return async (sectionId: string): Promise<HomeSection> => {
    const { data, error, response } = await client.GET('/api/v2/home/sections/{id}/items', {
      params: {
        header: { 'X-Profile-Id': profileId },
        path: { id: sectionId },
        query: { item_limit: rowLimit, ...ROW_IMAGE_QUERY },
      },
    });
    if (!data) throw toApiError(error, response);
    return data;
  };
}

/** Hides a card from Continue Watching or Next Up (a series is dropped from both). */
export function useDismissItem() {
  const { client, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useMutation({
    mutationFn: async ({ surface, item }: { surface: DismissSurface; item: HomeItem }) => {
      const { error, response } = await client.PUT('/api/v2/home/dismissals/{surface}/{item_id}', {
        params: {
          header: { 'X-Profile-Id': profileId },
          path: { surface, item_id: item.content_id },
        },
        // Continue Watching holds until the item is played again; Next Up drops the series.
        body:
          surface === 'continue_watching'
            ? { progress_updated_at: item.progress_updated_at }
            : { series_id: item.series_id ?? item.content_id },
      });
      if (!response.ok) throw toApiError(error, response);
    },
  });
}

/** The pages of one section's full list, 40 cards at a time, following the server's cursor. */
export function useSectionPages(sectionId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useInfiniteQuery({
    queryKey: ['home', 'section-pages', baseUrl, profileId, sectionId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          header: { 'X-Profile-Id': profileId },
          query: {
            source: 'section',
            scope: 'home',
            section_id: sectionId,
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
