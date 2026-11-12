import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { SiloApiError } from '../../api/problem';
import { useSilo } from '../../app/SiloContext';
import { IMAGE_WIDTHS } from '../../ui/media';

/**
 * The image query of the detail reads: the full-bleed backdrop and the title art at the hero's
 * size, posters at the card size of the "More like this" row, stills at the episode card size and
 * portraits at twice the cast card's width.
 */
export const DETAIL_IMAGE_QUERY = {
  poster_width: IMAGE_WIDTHS.rowPoster,
  backdrop_width: IMAGE_WIDTHS.backdrop,
  logo_width: IMAGE_WIDTHS.logo,
  still_width: IMAGE_WIDTHS.still,
  photo_width: 352,
} as const;

/** "More like this" asks for this many titles. */
export const SIMILAR_LIMIT = 12;
/** The box set row of a movie shows at most this many of its films. */
export const BOXSET_ROW_LIMIT = 20;
/** The cast row shows at most this many people. */
export const CAST_LIMIT = 24;

/** A title that is gone answers 404; asking again does not change that. */
export function retryUnlessMissing(count: number, error: unknown): boolean {
  if (error instanceof SiloApiError && error.status === 404) return false;
  return count < 1;
}

/** The cache keys of the reads a translation run polls (kept here so the run and the page agree). */
export const itemDetailKey = (baseUrl: string, profileId: string, itemId: string) =>
  ['detail', 'item', baseUrl, profileId, itemId] as const;
export const seasonEpisodesKey = (
  baseUrl: string,
  profileId: string,
  seriesId: string,
  season: number | undefined,
) => ['detail', 'episodes', baseUrl, profileId, seriesId, season ?? -1] as const;

export function useItemDetail(itemId: string, enabled = true) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: itemDetailKey(baseUrl, profileId, itemId),
    enabled,
    // The page comes back after the player: the watch state must be read again, not reused.
    refetchOnMount: 'always',
    retry: retryUnlessMissing,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/items/{id}', {
        params: {
          path: { id: itemId },
          query: DETAIL_IMAGE_QUERY,
        },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

export function useSeasons(seriesId: string, enabled: boolean) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['detail', 'seasons', baseUrl, profileId, seriesId],
    enabled,
    refetchOnMount: 'always',
    retry: retryUnlessMissing,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/series/{id}/seasons', {
        params: {
          path: { id: seriesId },
          query: DETAIL_IMAGE_QUERY,
        },
      });
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
}

export function useSeasonEpisodes(seriesId: string, season: number | undefined) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: seasonEpisodesKey(baseUrl, profileId, seriesId, season),
    enabled: season !== undefined,
    refetchOnMount: 'always',
    retry: retryUnlessMissing,
    queryFn: async () => {
      const { data, error, response } = await client.GET(
        '/api/v2/catalog/series/{id}/seasons/{num}/episodes',
        {
          params: {
            path: { id: seriesId, num: season ?? 0 },
            query: DETAIL_IMAGE_QUERY,
          },
        },
      );
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
}

/** Titles like this one; it starts once the page itself is shown, and a failure just hides the row. */
export function useSimilar(itemId: string, enabled: boolean) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['detail', 'similar', baseUrl, profileId, itemId],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET(
        '/api/v2/recommendations/similar/{item_id}',
        {
          params: {
            path: { item_id: itemId },
            query: { limit: SIMILAR_LIMIT, ...DETAIL_IMAGE_QUERY },
          },
        },
      );
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
}
