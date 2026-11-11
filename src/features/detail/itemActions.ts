// What a viewer may change on a title from its detail page: watched state, favourite, watchlist,
// "not interested" and the star rating. Each write goes through the generated client.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';
import type { ItemDetail } from './info';
import { itemDetailKey } from './queries';

/** The flags of `user_state` a viewer can switch on and off. */
export type UserFlag = 'is_favorite' | 'in_watchlist' | 'not_interested';

const NO_STATE: components['schemas']['CatalogItemUserState'] = {
  in_watchlist: false,
  is_favorite: false,
  not_interested: false,
  played: false,
};

/** Lists that show a title's state (home rows, library rows) read it again the next time they show. */
function staleLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['home'] });
  void queryClient.invalidateQueries({ queryKey: ['library'] });
}

/**
 * Marks a title (or a series, which marks all its episodes) watched or unwatched. Nothing changes
 * on screen before the server has answered; then every read that shows the title's state is read
 * again (the item, its series, the seasons, the episode lists, Home), and the mutation stays
 * pending until the page shows the new state.
 */
export function useSetWatched() {
  const { client } = useSilo();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, played }: { id: string; played: boolean }) => {
      const params = { params: { path: { id } } };
      const { error, response } = played
        ? await client.POST('/api/v2/watched/{id}', params)
        : await client.DELETE('/api/v2/watched/{id}', params);
      if (!response.ok) throw toApiError(error, response);
    },
    onSuccess: async () => {
      staleLists(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['detail'] });
    },
  });
}

/** Shows `patch` on the cached item at once; the returned function puts the shown values back. */
function showOnItem(
  queryClient: QueryClient,
  key: readonly unknown[],
  patch: (item: ItemDetail) => ItemDetail,
  restore: (item: ItemDetail, before: ItemDetail) => ItemDetail,
) {
  const before = queryClient.getQueryData<ItemDetail>(key);
  queryClient.setQueryData<ItemDetail>(key, (item) => (item ? patch(item) : item));
  return () => {
    if (before) {
      queryClient.setQueryData<ItemDetail>(key, (item) => (item ? restore(item, before) : item));
    }
  };
}

/**
 * Switches a flag of the title (favourite, watchlist, not interested) on or off. The page shows the
 * new state while the request runs and takes it back if the request fails.
 */
export function useSetUserFlag(itemId: string) {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  const key = itemDetailKey(baseUrl, session.get()?.profileId ?? '', itemId);
  return useMutation({
    mutationFn: async ({ flag, on }: { flag: UserFlag; on: boolean }) => {
      const params = { params: { path: { item_id: itemId } } };
      let result;
      if (flag === 'is_favorite') {
        result = on
          ? await client.PUT('/api/v2/favorites/{item_id}', params)
          : await client.DELETE('/api/v2/favorites/{item_id}', params);
      } else if (flag === 'in_watchlist') {
        result = on
          ? await client.PUT('/api/v2/watchlist/{item_id}', params)
          : await client.DELETE('/api/v2/watchlist/{item_id}', params);
      } else {
        result = on
          ? await client.PUT('/api/v2/not-interested/{item_id}', params)
          : await client.DELETE('/api/v2/not-interested/{item_id}', params);
      }
      if (!result.response.ok) throw toApiError(result.error, result.response);
    },
    onMutate: async ({ flag, on }) => {
      await queryClient.cancelQueries({ queryKey: key });
      return {
        undo: showOnItem(
          queryClient,
          key,
          (item) => ({ ...item, user_state: { ...(item.user_state ?? NO_STATE), [flag]: on } }),
          (item, before) => ({
            ...item,
            user_state: {
              ...(item.user_state ?? NO_STATE),
              [flag]: before.user_state?.[flag] ?? false,
            },
          }),
        ),
      };
    },
    onError: (_error, _variables, context) => context?.undo(),
    onSuccess: () => staleLists(queryClient),
  });
}

/** Sets the star rating (1 to 5) of the title, or clears it with `null`; shown at once, taken back on failure. */
export function useSetRating(itemId: string) {
  const { client, baseUrl, session } = useSilo();
  const queryClient = useQueryClient();
  const key = itemDetailKey(baseUrl, session.get()?.profileId ?? '', itemId);
  return useMutation({
    mutationFn: async (rating: number | null) => {
      const params = { params: { path: { item_id: itemId } } };
      const { error, response } =
        rating === null
          ? await client.DELETE('/api/v2/ratings/{item_id}', params)
          : await client.PUT('/api/v2/ratings/{item_id}', { ...params, body: { rating } });
      if (!response.ok) throw toApiError(error, response);
    },
    onMutate: async (rating) => {
      await queryClient.cancelQueries({ queryKey: key });
      return {
        undo: showOnItem(
          queryClient,
          key,
          (item) => ({ ...item, user_rating: rating ?? undefined }),
          (item, before) => ({ ...item, user_rating: before.user_rating }),
        ),
      };
    },
    onError: (_error, _variables, context) => context?.undo(),
  });
}
