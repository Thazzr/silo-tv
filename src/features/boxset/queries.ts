import { useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { IMAGE_WIDTHS } from '../../ui/media';
import { retryUnlessMissing } from '../detail/queries';

/** The box set page: grid posters for its films and the box set's backdrop at the hero's size. */
export const BOXSET_IMAGE_QUERY = {
  poster_width: IMAGE_WIDTHS.gridPoster,
  backdrop_width: IMAGE_WIDTHS.backdrop,
} as const;

/** The row on a movie's page: the films are shown at the row's card size. */
export const BOXSET_ROW_IMAGE_QUERY = {
  poster_width: IMAGE_WIDTHS.rowPoster,
  backdrop_width: IMAGE_WIDTHS.backdrop,
} as const;

/**
 * One box set with its films in collection order. A 404 means box sets are off for the library or
 * too few of its films are visible. The page comes back after a film or the player, so the counts
 * are read again whenever it shows.
 */
export function useBoxSet(boxSetId: string, libraryId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['boxset', 'item', baseUrl, profileId, boxSetId, libraryId],
    refetchOnMount: 'always',
    retry: retryUnlessMissing,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/box-sets/{id}', {
        params: {
          path: { id: boxSetId },
          query: { library_id: libraryId, ...BOXSET_IMAGE_QUERY },
        },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/**
 * The box set a movie's page shows, or null when the movie is in none (the server answers that with
 * a plain 200). Only asked once the server has said it has box sets. Read again whenever the page
 * shows again; a failed read just leaves the row away.
 */
export function useItemBoxSet(itemId: string, libraryId: string | undefined, enabled: boolean) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['detail', 'boxset', baseUrl, profileId, itemId, libraryId ?? ''],
    enabled,
    refetchOnMount: 'always',
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/items/{id}/box-set', {
        params: {
          path: { id: itemId },
          query: { library_id: libraryId, ...BOXSET_ROW_IMAGE_QUERY },
        },
      });
      if (!data) throw toApiError(error, response);
      return data.box_set ?? null;
    },
  });
}
