import { useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';

export type UserLibrary = components['schemas']['UserLibrary'];
export type CatalogItem = components['schemas']['CatalogItem'];

// Library types Silo stores as free text, with the spellings its own web client accepts.
// Mixed libraries hold movies and series, so they count as video too.
const VIDEO_TYPES = new Set(['movie', 'movies', 'series', 'tv', 'show', 'tvshows', 'mixed']);

/** The first library that holds movies or series. */
export function firstVideoLibrary(libraries: UserLibrary[]): UserLibrary | undefined {
  return libraries.find((library) => VIDEO_TYPES.has(library.type.trim().toLowerCase()));
}

const PAGE_SIZE = 20;

/** The user's libraries, then the first page of titles of the first video library. */
export function useFirstLibrary() {
  const { client, baseUrl, session } = useSilo();
  const profileId = session.get()?.profileId ?? '';

  const libraries = useQuery({
    queryKey: ['libraries', baseUrl, profileId],
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/user/libraries');
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });
  const library = libraries.data ? firstVideoLibrary(libraries.data) : undefined;

  const titles = useQuery({
    queryKey: ['catalog', baseUrl, profileId, library?.id ?? ''],
    enabled: Boolean(library),
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          query: { library_id: library?.id, limit: PAGE_SIZE },
          header: { 'X-Profile-Id': profileId },
        },
      });
      if (!data) throw toApiError(error, response);
      return data.items;
    },
  });

  const failed = libraries.isError || titles.isError;
  return {
    library,
    items: titles.data,
    // Loading covers both requests, so the list never flashes an empty state in between.
    isLoading: !failed && (libraries.isPending || (Boolean(library) && titles.isPending)),
    isError: failed,
    noLibrary: libraries.isSuccess && !library,
    retry: () => {
      if (libraries.isError) void libraries.refetch();
      else void titles.refetch();
    },
  };
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
