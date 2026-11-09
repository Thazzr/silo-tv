import { useMutation, useQuery } from '@tanstack/react-query';
import { toApiError } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useSilo } from '../../app/SiloContext';

export type UserLibrary = components['schemas']['UserLibrary'];
export type CatalogItem = components['schemas']['CatalogItem'];

// Library types Silo stores as free text, with the spellings its own web client accepts.
// Mixed libraries hold movies and series, so they count as video too.
const MOVIE_TYPES = ['movie', 'movies'];
const SERIES_TYPES = ['series', 'tv', 'show', 'tvshows'];
const MIXED_TYPES = ['mixed'];

/** What a tab lists: any video library (Home), or movies or series only. */
export type LibraryKind = 'video' | 'movie' | 'series';

const KIND_TYPES: Record<LibraryKind, Set<string>> = {
  video: new Set([...MOVIE_TYPES, ...SERIES_TYPES, ...MIXED_TYPES]),
  movie: new Set([...MOVIE_TYPES, ...MIXED_TYPES]),
  series: new Set([...SERIES_TYPES, ...MIXED_TYPES]),
};

/** The first library of the kind; a mixed library counts for every kind. */
export function firstLibraryOfKind(
  libraries: UserLibrary[],
  kind: LibraryKind,
): UserLibrary | undefined {
  return libraries.find((library) => KIND_TYPES[kind].has(library.type.trim().toLowerCase()));
}

/** The first library that holds movies or series. */
export function firstVideoLibrary(libraries: UserLibrary[]): UserLibrary | undefined {
  return firstLibraryOfKind(libraries, 'video');
}

const PAGE_SIZE = 20;

/** The user's libraries, then the first page of titles of the first library of the kind. */
export function useFirstLibrary(kind: LibraryKind = 'video') {
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
  const library = libraries.data ? firstLibraryOfKind(libraries.data, kind) : undefined;
  // A mixed library holds both; the tab asks the server for its own kind.
  const mixedType =
    library && kind !== 'video' && MIXED_TYPES.includes(library.type.trim().toLowerCase())
      ? kind
      : undefined;

  const titles = useQuery({
    queryKey: ['catalog', baseUrl, profileId, library?.id ?? '', mixedType ?? ''],
    enabled: Boolean(library),
    queryFn: async () => {
      const { data, error, response } = await client.GET('/api/v2/catalog', {
        params: {
          query: { library_id: library?.id, type: mixedType, limit: PAGE_SIZE },
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
