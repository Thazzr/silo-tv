// The library reads, pinned request by request: path, query, body, header, cache key, paging and
// the mapping of the answers. A failed read must throw a SiloApiError.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { SiloApiError } from '../../api/problem';
import { Session } from '../../api/session';
import { SiloProvider } from '../../app/SiloContext';
import { BASE_URL, account } from '../../test/apiFixtures';
import { catalogItem, catalogPage, library } from '../../test/flowFixtures';
import { homeCapabilities, homeSection } from '../../test/homeFixtures';
import { collectionCard, collectionTab, facets } from '../../test/libraryFixtures';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import { DEFAULT_BROWSE, WATCH_PROBE_GROUPS, type BrowseSelection } from './browse';
import {
  isMixed,
  librariesOfKind,
  orderedCollections,
  useBoxSetsAvailable,
  useBrowsePages,
  useCatalogFilters,
  useCollectionPages,
  useExtendedRules,
  useLetters,
  useLibraries,
  useLibraryCollections,
  useLibrarySections,
  useSearchCapabilities,
  useSignOut,
  useWatchRules,
} from './queries';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ROW_IMAGES = {
  poster_width: '352',
  backdrop_width: '1920',
  logo_width: '880',
  still_width: '720',
};
const GRID_IMAGES = { poster_width: '520', still_width: '720' };

function harness(profileId: string | null = 'p1') {
  const session = new Session(memoryStorage());
  if (profileId !== null) {
    session.set({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      user: account,
      profileId,
    });
  }
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, refetchOnWindowFocus: false, retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SiloProvider baseUrl={BASE_URL} session={session} device={testDevice}>
        {children}
      </SiloProvider>
    </QueryClientProvider>
  );
  return { wrapper, client, session };
}

interface Seen {
  url: URL;
  profile: string | null;
  body: unknown;
}

type Reply = Response | Record<string, unknown> | null;
type Answer = Reply | ((seen: Seen[]) => Reply);

const problem = (status: number, code = 'boom') =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Problem', status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

/** Answers one route with `answer` (or a problem when `fail` is a status) and records requests. */
function serve(
  method: 'get' | 'post',
  path: string,
  answer: Answer,
  options: { fail?: number } = {},
): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http[method](`${BASE_URL}${path}`, async ({ request }) => {
      let body: unknown;
      if (method === 'post' && request.headers.get('content-type')?.includes('json')) {
        body = await request.json();
      }
      seen.push({
        url: new URL(request.url),
        profile: request.headers.get('X-Profile-Id'),
        body,
      });
      if (options.fail) return problem(options.fail);
      const value = typeof answer === 'function' ? answer(seen) : answer;
      return value instanceof Response ? value : HttpResponse.json(value);
    }),
  );
  return seen;
}

const paramsOf = (url: URL) => Object.fromEntries(url.searchParams.entries());
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe('library kinds', () => {
  const typed = (type: string) => library({ id: type, type });

  it('lists the libraries of a tab by the spellings Silo accepts, ignoring case and spaces', () => {
    const all = [
      'movie',
      'Movies',
      ' MOVIE ',
      'series',
      'tv',
      ' TV ',
      'Show',
      'tvshows',
      'mixed',
      ' Mixed ',
      'music',
      'books',
      '',
    ].map(typed);
    expect(librariesOfKind(all, 'movie').map((l) => l.id)).toEqual([
      'movie',
      'Movies',
      ' MOVIE ',
      'mixed',
      ' Mixed ',
    ]);
    expect(librariesOfKind(all, 'series').map((l) => l.id)).toEqual([
      'series',
      'tv',
      ' TV ',
      'Show',
      'tvshows',
      'mixed',
      ' Mixed ',
    ]);
  });

  it('knows a mixed library however it is spelled, and no other', () => {
    expect(isMixed(typed('mixed'))).toBe(true);
    expect(isMixed(typed('  MIXED '))).toBe(true);
    expect(isMixed(typed('movies'))).toBe(false);
    expect(isMixed(typed('series'))).toBe(false);
  });
});

describe('useLibraries', () => {
  it('reads the user libraries and returns the items, under the server and profile key', async () => {
    const seen = serve('get', '/api/v2/user/libraries', {
      items: [library({ id: 'a' }), library({ id: 'b' })],
    });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useLibraries(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url.search).toBe('');
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.map((l) => l.id)).toEqual(['a', 'b']);
    expect(client.getQueryData(['libraries', BASE_URL, 'p1'])).toBe(result.current.data);
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/user/libraries', { items: [] });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useLibraries(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['libraries', BASE_URL, ''])).toEqual([]);
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('get', '/api/v2/user/libraries', null, { fail: 500 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useLibraries(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect((result.current.error as SiloApiError).code).toBe('boom');
  });
});

describe('useLibrarySections', () => {
  it('reads the sections of one library without a limit while the capabilities are not cached', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    const seen = serve('get', '/api/v2/library/lib-1/sections', {
      sections: [homeSection('a')],
    });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useLibrarySections('lib-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual(ROW_IMAGES);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.map((s) => s.id)).toEqual(['a']);
    expect(client.getQueryData(['library', 'sections', BASE_URL, 'p1', 'lib-1'])).toBe(
      result.current.data,
    );
  });

  it('carries the cached section limit', async () => {
    const seen = serve('get', '/api/v2/library/lib-1/sections', { sections: [] });
    const { wrapper, client } = harness();
    client.setQueryData(
      ['home', 'capabilities', BASE_URL],
      homeCapabilities({ section_item_limit_max: 9 }),
    );
    const { result } = renderHook(() => useLibrarySections('lib-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({ item_limit: '9', ...ROW_IMAGES });
  });

  it('keys a signed-out read with an empty profile and throws a SiloApiError on failure', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    serve('get', '/api/v2/library/lib-1/sections', { sections: [] });
    const out = harness(null);
    const ok = renderHook(() => useLibrarySections('lib-1'), { wrapper: out.wrapper });
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(out.client.getQueryData(['library', 'sections', BASE_URL, '', 'lib-1'])).toEqual([]);

    server.resetHandlers();
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    serve('get', '/api/v2/library/lib-1/sections', null, { fail: 500 });
    const bad = renderHook(() => useLibrarySections('lib-1'), { wrapper: harness().wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBeInstanceOf(SiloApiError);
  });
});

describe('useBrowsePages', () => {
  const GENRE_GROUPS = [
    { match: 'any', rules: [{ field: 'genre', op: 'contains', value: 'Drama' }] },
  ];
  const browsePage = (ids: string[], next?: string): S['CatalogBrowseCollection'] => ({
    ...catalogPage(ids.map((id) => catalogItem({ content_id: id }))),
    page: next ? { has_more: true, next_cursor: next } : { has_more: false },
  });
  const browseKey = (client: QueryClient) =>
    client.getQueryCache().findAll({ queryKey: ['library', 'browse'] })[0]!.queryKey;

  it('reads the unfiltered first page: title order, all rules matching, 40 titles', async () => {
    const seen = serve('get', '/api/v2/catalog', browsePage(['a']));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useBrowsePages('lib-1', 'movie', DEFAULT_BROWSE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({
      library_id: 'lib-1',
      type: 'movie',
      sort: 'title',
      match: 'all',
      limit: '40',
      ...GRID_IMAGES,
    });
    expect(seen[0]!.profile).toBe('p1');
    expect(browseKey(client)).toEqual([
      'library',
      'browse',
      BASE_URL,
      'p1',
      'lib-1',
      'movie',
      'title',
      '',
      [],
      '',
    ]);
  });

  it('sends the sort, the rule groups, every content rating and the letter as a title prefix', async () => {
    const seen = serve('get', '/api/v2/catalog', browsePage(['a']));
    const { wrapper, client } = harness('p1');
    const selection: BrowseSelection = {
      sort: 'added_at',
      descending: true,
      filters: { genre: ['Drama'], content_rating: ['PG', 'R'] },
      letter: 'B',
    };
    const { result } = renderHook(() => useBrowsePages('lib-1', 'series', selection), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = seen[0]!.url;
    expect(url.searchParams.get('type')).toBe('series');
    expect(url.searchParams.get('sort')).toBe('-added_at');
    expect(url.searchParams.get('match')).toBe('all');
    expect(JSON.parse(url.searchParams.get('groups')!)).toEqual(GENRE_GROUPS);
    expect(url.searchParams.getAll('content_rating')).toEqual(['PG', 'R']);
    expect(url.searchParams.get('name_prefix')).toBe('B');
    expect(browseKey(client)).toEqual([
      'library',
      'browse',
      BASE_URL,
      'p1',
      'lib-1',
      'series',
      '-added_at',
      JSON.stringify(GENRE_GROUPS),
      ['PG', 'R'],
      'B',
    ]);
  });

  it('turns "#" into the numbered-titles rule group and sends no title prefix', async () => {
    const seen = serve('get', '/api/v2/catalog', browsePage(['a']));
    const { wrapper, client } = harness();
    const { result } = renderHook(
      () => useBrowsePages('lib-1', 'movie', { ...DEFAULT_BROWSE, letter: '#' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = seen[0]!.url;
    expect(url.searchParams.has('name_prefix')).toBe(false);
    const groups = JSON.parse(url.searchParams.get('groups')!) as S['CatalogQueryGroup'][];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rules.map((r) => r.value)).toEqual(
      Array.from({ length: 10 }, (_, d) => String(d)),
    );
    expect(browseKey(client)[7]).toBe(url.searchParams.get('groups'));
    expect(browseKey(client)[9]).toBe('#');
  });

  it('follows the server cursor page by page', async () => {
    const seen = serve('get', '/api/v2/catalog', (all) =>
      all.length === 1 ? browsePage(['a'], 'c2') : browsePage(['b']),
    );
    const { wrapper } = harness();
    const { result } = renderHook(() => useBrowsePages('lib-1', 'movie', DEFAULT_BROWSE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]!.url.searchParams.has('cursor')).toBe(false);
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    expect(seen[1]!.url.searchParams.get('cursor')).toBe('c2');
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('has no next page without paging info, and keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/catalog', catalogPage([]));
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useBrowsePages('lib-1', 'movie', DEFAULT_BROWSE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
    expect(browseKey(client)[3]).toBe('');
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('get', '/api/v2/catalog', null, { fail: 500 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useBrowsePages('lib-1', 'movie', DEFAULT_BROWSE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
  });
});

describe('search capabilities', () => {
  const caps = (overrides: Partial<S['CatalogSearchCapabilities']> = {}) =>
    ({
      allowed: true,
      revision: 'r1',
      state: 'available',
      ...overrides,
    }) satisfies S['CatalogSearchCapabilities'];

  it('reads the capabilities once, with the profile, under the server and profile key', async () => {
    const seen = serve('get', '/api/v2/catalog/search/capabilities', caps({ box_sets: true }));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSearchCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.box_sets).toBe(true);
    expect(client.getQueryData(['library', 'search-capabilities', BASE_URL, 'p1'])).toBe(
      result.current.data,
    );
    // Read once per session: coming back does not ask again.
    renderHook(() => useSearchCapabilities(), { wrapper });
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/catalog/search/capabilities', caps());
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSearchCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['library', 'search-capabilities', BASE_URL, ''])).toBeDefined();
  });

  it('throws a SiloApiError on a failed read and does not ask again', async () => {
    const seen = serve('get', '/api/v2/catalog/search/capabilities', null, { fail: 500 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('counts a capability as on only when the server says true', async () => {
    serve(
      'get',
      '/api/v2/catalog/search/capabilities',
      caps({ extended_query_rules: true, box_sets: true }),
    );
    const on = renderHook(() => [useExtendedRules(), useBoxSetsAvailable()], {
      wrapper: harness().wrapper,
    });
    await waitFor(() => expect(on.result.current).toEqual([true, true]));

    server.resetHandlers();
    serve('get', '/api/v2/catalog/search/capabilities', caps());
    const absent = renderHook(() => [useExtendedRules(), useBoxSetsAvailable()], {
      wrapper: harness().wrapper,
    });
    await tick();
    expect(absent.result.current).toEqual([false, false]);

    server.resetHandlers();
    serve(
      'get',
      '/api/v2/catalog/search/capabilities',
      caps({ extended_query_rules: false, box_sets: false }),
    );
    const off = renderHook(() => [useExtendedRules(), useBoxSetsAvailable()], {
      wrapper: harness().wrapper,
    });
    await tick();
    expect(off.result.current).toEqual([false, false]);

    server.resetHandlers();
    serve('get', '/api/v2/catalog/search/capabilities', null, { fail: 500 });
    const failed = renderHook(() => [useExtendedRules(), useBoxSetsAvailable()], {
      wrapper: harness().wrapper,
    });
    await tick();
    expect(failed.result.current).toEqual([false, false]);
  });
});

describe('useCatalogFilters', () => {
  it('reads the facets of a library and kind, under its key', async () => {
    const seen = serve('get', '/api/v2/catalog/filters', facets());
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useCatalogFilters('lib-1', 'series'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({ library_id: 'lib-1', type: 'series' });
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.genres).toEqual(['Action', 'Drama', 'Sci-Fi']);
    expect(client.getQueryData(['library', 'filters', BASE_URL, 'p1', 'lib-1', 'series'])).toBe(
      result.current.data,
    );
  });

  it('keys a signed-out read with an empty profile and throws a SiloApiError on failure', async () => {
    serve('get', '/api/v2/catalog/filters', facets());
    const out = harness(null);
    const ok = renderHook(() => useCatalogFilters('lib-1', 'movie'), { wrapper: out.wrapper });
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(
      out.client.getQueryData(['library', 'filters', BASE_URL, '', 'lib-1', 'movie']),
    ).toBeDefined();

    server.resetHandlers();
    serve('get', '/api/v2/catalog/filters', null, { fail: 500 });
    const bad = renderHook(() => useCatalogFilters('lib-1', 'movie'), {
      wrapper: harness().wrapper,
    });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBeInstanceOf(SiloApiError);
  });
});

describe('useWatchRules', () => {
  it('asks for one title under "watched is false" and answers yes on a 2xx', async () => {
    const seen = serve('get', '/api/v2/catalog', catalogPage([]));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useWatchRules('lib-1', 'movie'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(seen).toHaveLength(1);
    expect(paramsOf(seen[0]!.url)).toEqual({
      library_id: 'lib-1',
      type: 'movie',
      match: 'all',
      groups: JSON.stringify(WATCH_PROBE_GROUPS),
      limit: '1',
      skip_total: 'true',
    });
    expect(JSON.parse(seen[0]!.url.searchParams.get('groups')!)).toEqual([
      { match: 'any', rules: [{ field: 'watched', op: 'is', value: false }] },
    ]);
    expect(seen[0]!.profile).toBe('p1');
    expect(client.getQueryData(['library', 'watch-rules', BASE_URL, 'p1'])).toBe(true);
    // Kept for the session: a second reader does not probe again.
    renderHook(() => useWatchRules('lib-2', 'series'), { wrapper });
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('answers no on a 422, and probes only once', async () => {
    const seen = serve('get', '/api/v2/catalog', null, { fail: 422 });
    const { wrapper, client } = harness();
    const { result } = renderHook(() => useWatchRules('lib-1', 'movie'), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(1));
    await waitFor(() =>
      expect(client.getQueryState(['library', 'watch-rules', BASE_URL, 'p1'])?.status).toBe(
        'error',
      ),
    );
    await tick();
    expect(result.current).toBe(false);
    expect(seen).toHaveLength(1);
    expect(client.getQueryState(['library', 'watch-rules', BASE_URL, 'p1'])?.error).toBeInstanceOf(
      SiloApiError,
    );
  });

  it('keys a signed-out probe with an empty profile', async () => {
    serve('get', '/api/v2/catalog', catalogPage([]));
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useWatchRules('lib-1', 'movie'), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
    expect(client.getQueryData(['library', 'watch-rules', BASE_URL, ''])).toBe(true);
  });
});

describe('useLetters', () => {
  it('posts the filter groups and returns the letters that have titles', async () => {
    const seen = serve('post', '/api/v2/catalog/letters', {
      letters: [
        { letter: '#', count: 0, position: 0 },
        { letter: 'A', count: 3, position: 0 },
        { letter: 'B', count: 0, position: 3 },
        { letter: 'C', count: 1, position: 3 },
      ],
      runs: [],
      total: 4,
    });
    const { wrapper, client } = harness('p1');
    const selection: BrowseSelection = {
      ...DEFAULT_BROWSE,
      sort: 'year',
      letter: 'C',
      filters: { genre: ['Drama'] },
    };
    const { result } = renderHook(() => useLetters('lib-1', 'movie', selection), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const groups = [{ match: 'any', rules: [{ field: 'genre', op: 'contains', value: 'Drama' }] }];
    expect(seen[0]!.body).toEqual({ library_id: 'lib-1', type: 'movie', match: 'all', groups });
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data).toBeInstanceOf(Set);
    expect([...result.current.data!]).toEqual(['A', 'C']);
    expect(
      client.getQueryData([
        'library',
        'letters',
        BASE_URL,
        'p1',
        'lib-1',
        'movie',
        JSON.stringify(groups),
      ]),
    ).toBe(result.current.data);
  });

  it('sends an empty group list for no filters and keys a signed-out read with an empty profile', async () => {
    const seen = serve('post', '/api/v2/catalog/letters', { letters: [], runs: [], total: 0 });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useLetters('lib-1', 'series', DEFAULT_BROWSE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]!.body).toEqual({
      library_id: 'lib-1',
      type: 'series',
      match: 'all',
      groups: [],
    });
    expect(
      client.getQueryData(['library', 'letters', BASE_URL, '', 'lib-1', 'series', '[]']),
    ).toBeInstanceOf(Set);
  });

  it('throws a SiloApiError on a failed read and does not ask again', async () => {
    const seen = serve('post', '/api/v2/catalog/letters', null, { fail: 501 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useLetters('lib-1', 'movie', DEFAULT_BROWSE), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect((result.current.error as SiloApiError).status).toBe(501);
    await tick();
    expect(seen).toHaveLength(1);
  });
});

describe('orderedCollections', () => {
  const ids = (tab: S['LibraryCollectionTab']) => orderedCollections(tab).map((c) => c.id);

  it('lists the groups by their order, with the ungrouped ones at their own place', () => {
    const a = collectionCard('a');
    const b = collectionCard('b');
    const c = collectionCard('c');
    const d = collectionCard('d');
    expect(
      ids(
        collectionTab(
          'lib',
          [
            { name: 'Late', order: 5, cards: [c] },
            { name: 'Early', order: 1, cards: [a] },
          ],
          { order: 3, cards: [b, d] },
        ),
      ),
    ).toEqual(['a', 'b', 'd', 'c']);
    expect(
      ids(collectionTab('lib', [{ name: 'Only', order: 4, cards: [a] }], { order: 0, cards: [b] })),
    ).toEqual(['b', 'a']);
  });

  it('works without ungrouped cards and without any group', () => {
    expect(
      ids(collectionTab('lib', [{ name: 'G', order: 1, cards: [collectionCard('a')] }])),
    ).toEqual(['a']);
    expect(ids(collectionTab('lib', []))).toEqual([]);
  });

  it('lists a collection once, at its first place', () => {
    const a = collectionCard('a');
    const b = collectionCard('b');
    expect(
      ids(
        collectionTab(
          'lib',
          [
            { name: 'One', order: 1, cards: [a, b] },
            { name: 'Two', order: 2, cards: [b, a] },
          ],
          { order: 3, cards: [a] },
        ),
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('useLibraryCollections', () => {
  it('reads the collections of a library as ordered cards and a description map', async () => {
    const seen = serve(
      'get',
      '/api/v2/library/lib-1/collections',
      collectionTab(
        'lib-1',
        [{ name: 'G', order: 2, cards: [collectionCard('b')] }],
        { order: 1, cards: [collectionCard('a')] },
        { a: 'About a', b: 'About b' },
      ),
    );
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useLibraryCollections('lib-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]!.url.search).toBe('');
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.current.data?.descriptions).toBeInstanceOf(Map);
    // The map follows the server's `collections` list, not the card order.
    expect([...result.current.data!.descriptions]).toEqual([
      ['b', 'About b'],
      ['a', 'About a'],
    ]);
    expect(client.getQueryData(['library', 'collections', BASE_URL, 'p1', 'lib-1'])).toBe(
      result.current.data,
    );
  });

  it('keys a signed-out read with an empty profile and throws a SiloApiError on failure', async () => {
    serve('get', '/api/v2/library/lib-1/collections', collectionTab('lib-1', []));
    const out = harness(null);
    const ok = renderHook(() => useLibraryCollections('lib-1'), { wrapper: out.wrapper });
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(
      out.client.getQueryData(['library', 'collections', BASE_URL, '', 'lib-1']),
    ).toBeDefined();

    server.resetHandlers();
    serve('get', '/api/v2/library/lib-1/collections', null, { fail: 500 });
    const bad = renderHook(() => useLibraryCollections('lib-1'), { wrapper: harness().wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBeInstanceOf(SiloApiError);
  });
});

describe('useCollectionPages', () => {
  const page = (ids: string[], next?: string): S['CatalogItemCollection'] => ({
    items: ids.map((id) => catalogItem({ content_id: id })),
    page: next ? { has_more: true, next_cursor: next } : { has_more: false },
  });

  it('reads the items of one collection 40 at a time and follows the cursor', async () => {
    const seen = serve('get', '/api/v2/library/lib-1/collections/col-1/items', (all) =>
      all.length === 1 ? page(['a'], 'c2') : page(['b']),
    );
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useCollectionPages('lib-1', 'col-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({ limit: '40' });
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.hasNextPage).toBe(true);
    expect(
      client.getQueryData(['library', 'collection-items', BASE_URL, 'p1', 'lib-1', 'col-1']),
    ).toBeDefined();
    await act(() => result.current.fetchNextPage());
    expect(seen[1]!.url.searchParams.get('cursor')).toBe('c2');
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('has no next page without paging info, and keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/library/lib-1/collections/col-1/items', { items: [] });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useCollectionPages('lib-1', 'col-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
    expect(
      client.getQueryData(['library', 'collection-items', BASE_URL, '', 'lib-1', 'col-1']),
    ).toBeDefined();
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('get', '/api/v2/library/lib-1/collections/col-1/items', null, { fail: 500 });
    const { wrapper } = harness();
    const { result } = renderHook(() => useCollectionPages('lib-1', 'col-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
  });
});

describe('useSignOut', () => {
  it('ends the session on the server and clears it locally', async () => {
    const seen = serve(
      'post',
      '/api/v2/auth/logout',
      () => new HttpResponse(null, { status: 204 }),
    );
    const { wrapper, session } = harness('p1');
    const signedOut = vi.fn();
    session.on('signedOut', signedOut);
    const { result } = renderHook(() => useSignOut(), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(seen).toHaveLength(1);
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(session.get()).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('clears the session whatever the answer was, and throws the problem as a SiloApiError', async () => {
    serve('post', '/api/v2/auth/logout', null, { fail: 500 });
    const { wrapper, session } = harness('p1');
    const { result } = renderHook(() => useSignOut(), { wrapper });
    await expect(act(() => result.current.mutateAsync())).rejects.toBeInstanceOf(SiloApiError);
    expect(session.get()).toBeNull();
  });
});
