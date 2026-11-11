import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import { useSilo } from '../../app/SiloContext';
import { GRID_IMAGE_QUERY } from '../../ui/media';
import { retryUnlessMissing } from '../detail/queries';
import { GRID_PAGE_SIZE } from '../home/queries';
import { FILTER_TYPE, type PersonFilter } from './info';

/**
 * One person. A person none of whose credits the viewer can see answers 404. The read is a plain
 * one: the page does not send `prefetch` and does not ask for a provider refresh.
 */
export function usePerson(personId: string) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['person', 'item', baseUrl, profileId, personId],
    retry: retryUnlessMissing,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog/people/{id}', {
        params: { path: { id: personId } },
      });
      if (!data) throw toApiError(error, response);
      return data;
    },
  });
}

/** The pages of a person's titles of one kind, newest first, 40 at a time, following the cursor. */
export function usePersonTitles(personId: string, filter: PersonFilter) {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useInfiniteQuery({
    queryKey: ['person', 'titles', baseUrl, profileId, personId, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          query: {
            source: 'person',
            person_id: personId,
            type: FILTER_TYPE[filter],
            sort: '-year',
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
 * Whether the person has a title of this kind: a one-card read. A failed probe counts as "no", so
 * its pill stays away rather than leading to a list that cannot load.
 */
export function usePersonHas(personId: string, filter: 'movie' | 'series') {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';
  return useQuery({
    queryKey: ['person', 'has', baseUrl, profileId, personId, filter],
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          query: {
            source: 'person',
            person_id: personId,
            type: FILTER_TYPE[filter],
            sort: '-year',
            limit: 1,
          },
        },
      });
      if (!data) throw toApiError(error, response);
      return data.items.length > 0;
    },
  });
}
