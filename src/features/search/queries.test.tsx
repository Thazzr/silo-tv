// The Search reads, pinned request by request: the quiet period, path, query, header, cache key,
// `enabled` rules, paging, the stale-cursor restart and the mapping of the answers.
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
import { memoryStorage, testDevice } from '../../test/renderFlow';
import { matches, personMatch } from '../../test/searchFixtures';
import { quietPeriod, useSearchBoxSets, useSearchPeople, useSearchTitles } from './queries';
import type { Segment } from './info';

type S = components['schemas'];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

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

/**
 * Holds back the timers of exactly the 300 ms search delay instead of running them, so a test
 * pins the quiet period without any wall clock. `rest` checks that nothing was sent while the
 * timer is held, then releases it.
 */
function holdQuietPeriod() {
  const realSetTimeout = globalThis.setTimeout;
  const held: (() => void)[] = [];
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    fn: () => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === 300) {
      held.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout);
  return {
    held,
    async rest(sent: () => number) {
      await waitFor(() => expect(held).toHaveLength(1));
      await new Promise((resolve) => realSetTimeout(resolve, 50));
      expect(sent()).toBe(0);
      held[0]!();
    },
  };
}

interface Seen {
  url: URL;
  profile: string | null;
}

interface Routes {
  capabilities?: Partial<S['CatalogSearchCapabilities']>;
  /** Holds the capabilities answer until released. */
  holdCapabilities?: Promise<void>;
  titles?: (seen: Seen[]) => Response;
  boxSets?: (seen: Seen[]) => Response;
  people?: (seen: Seen[]) => Response;
}

interface Served {
  capabilities: Seen[];
  titles: Seen[];
  boxSets: Seen[];
  people: Seen[];
}

const problem = (status: number, code: string) =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Problem', status, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const record = (request: Request): Seen => ({
  url: new URL(request.url),
  profile: request.headers.get('X-Profile-Id'),
});

function serve(routes: Routes = {}): Served {
  const served: Served = { capabilities: [], titles: [], boxSets: [], people: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/search/capabilities`, async ({ request }) => {
      served.capabilities.push(record(request));
      if (routes.holdCapabilities) await routes.holdCapabilities;
      return HttpResponse.json({
        allowed: true,
        revision: 'r1',
        state: 'available',
        ...routes.capabilities,
      } satisfies S['CatalogSearchCapabilities']);
    }),
    http.get(`${BASE_URL}/api/v2/catalog`, ({ request }) => {
      served.titles.push(record(request));
      return (
        routes.titles?.(served.titles) ??
        HttpResponse.json({
          items: matches('Title', 2),
          total: 2,
          total_exact: true,
          window_cursor: 'w',
          page: { has_more: false },
        } satisfies S['CatalogBrowseCollection'])
      );
    }),
    http.get(`${BASE_URL}/api/v2/catalog/box-sets`, ({ request }) => {
      served.boxSets.push(record(request));
      return routes.boxSets?.(served.boxSets) ?? HttpResponse.json({ items: [] });
    }),
    http.get(`${BASE_URL}/api/v2/catalog/people`, ({ request }) => {
      served.people.push(record(request));
      return routes.people?.(served.people) ?? HttpResponse.json({ items: [] });
    }),
  );
  return served;
}

const paramsOf = (url: URL) => Object.fromEntries(url.searchParams.entries());
const tick = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));
const boxSet = (id: string): S['CatalogBoxSet'] =>
  ({ id, title: `Box ${id}`, item_count: 2 }) as unknown as S['CatalogBoxSet'];

describe('quietPeriod', () => {
  it('resolves once the delay has passed, and not before', async () => {
    vi.useFakeTimers();
    let done = false;
    const promise = quietPeriod(new AbortController().signal, 300).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(done).toBe(true);
  });

  it('waits 300 ms by default', async () => {
    vi.useFakeTimers();
    let done = false;
    const promise = quietPeriod(new AbortController().signal).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(done).toBe(true);
  });

  it('rejects at once with an AbortError for a signal that is already aborted, setting no timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const error = await quietPeriod(controller.signal, 300).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect((error as DOMException).message).toBe('The search was replaced');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with an AbortError when the signal aborts during the wait and clears its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = quietPeriod(controller.signal, 300).catch((e: unknown) => e);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect((error as DOMException).message).toBe('The search was replaced');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('listens once for the abort and lets go of the signal when it is done', async () => {
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, 'addEventListener');
    const remove = vi.spyOn(signal, 'removeEventListener');
    const promise = quietPeriod(signal, 10);
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });
});

describe('useSearchTitles', () => {
  it('searches the typed text in the video scope with the profile, 40 titles and the grid images', async () => {
    const served = serve();
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(served.titles).toHaveLength(1);
    expect(paramsOf(served.titles[0]!.url)).toEqual({
      q: 'abc',
      type: 'video',
      limit: '40',
      ...GRID_IMAGES,
    });
    expect(served.titles[0]!.profile).toBe('p1');
    expect(result.current.data?.pages[0]?.items).toHaveLength(2);
    expect(result.current.capabilitiesPending).toBe(false);
    expect(client.getQueryData(['search', 'titles', BASE_URL, 'p1', 'abc', 'video'])).toBeDefined();
  });

  it('scopes the search by segment and by what the server can', async () => {
    serve({ capabilities: { video_with_episodes_scope: true } });
    const { wrapper, client } = harness('p1');
    const all = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    const movies = renderHook(() => useSearchTitles('abc', 'movies'), { wrapper });
    const series = renderHook(() => useSearchTitles('abc', 'series'), { wrapper });
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(movies.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(series.result.current.isSuccess).toBe(true));
    for (const type of ['video_with_episodes', 'movie', 'series']) {
      expect(client.getQueryData(['search', 'titles', BASE_URL, 'p1', 'abc', type])).toBeDefined();
    }
  });

  it('sends nothing for an empty query', async () => {
    const served = serve();
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchTitles('', 'all'), { wrapper });
    await waitFor(() => expect(result.current.capabilitiesPending).toBe(false));
    await tick();
    expect(result.current.fetchStatus).toBe('idle');
    expect(served.titles).toHaveLength(0);
  });

  it('waits for the capabilities before it searches', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const served = serve({ holdCapabilities: gate });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await tick();
    expect(result.current.capabilitiesPending).toBe(true);
    expect(served.titles).toHaveLength(0);
    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(served.titles).toHaveLength(1);
  });

  it('rests for the quiet period before the first page but not before the next ones', async () => {
    const served = serve({
      titles: (seen) =>
        HttpResponse.json({
          items: matches('Title', 1, seen.length),
          total: 2,
          total_exact: true,
          window_cursor: 'w',
          page: seen.length === 1 ? { has_more: true, next_cursor: 'c2' } : { has_more: false },
        } satisfies S['CatalogBrowseCollection']),
    });
    const { wrapper } = harness();
    const quiet = holdQuietPeriod();
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(served.capabilities).toHaveLength(1));
    // The 300 ms quiet period is held back on purpose: nothing is sent until it is released.
    await quiet.rest(() => served.titles.length);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());
    expect(served.titles).toHaveLength(2);
    expect(quiet.held).toHaveLength(1);
    expect(served.titles[1]!.url.searchParams.get('cursor')).toBe('c2');
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('has no next page when the answer carries no paging info', async () => {
    serve({
      titles: () =>
        HttpResponse.json({
          items: [],
          total: 0,
          total_exact: true,
          window_cursor: 'w',
        } satisfies S['CatalogBrowseCollection']),
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve({ titles: () => problem(500, 'boom') });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect((result.current.error as SiloApiError).code).toBe('boom');
  });

  it('keys a signed-out search with an empty profile', async () => {
    serve();
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['search', 'titles', BASE_URL, '', 'abc', 'video'])).toBeDefined();
  });

  it('starts over from the first page when the server no longer knows the cursor, and only then', async () => {
    const served = serve({
      titles: (seen) => {
        if (seen.length === 2) return problem(400, 'invalid_cursor');
        return HttpResponse.json({
          items: matches('Title', 1, seen.length),
          total: 2,
          total_exact: true,
          window_cursor: 'w',
          page: { has_more: true, next_cursor: 'c2' },
        } satisfies S['CatalogBrowseCollection']);
      },
    });
    const { wrapper, client } = harness('p1');
    const key = ['search', 'titles', BASE_URL, 'p1', 'abc', 'video'];
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A query below this key must survive: only the one query is reset, not its prefix family.
    client.setQueryData([...key, 'neighbour'], 'kept');
    await act(() => result.current.fetchNextPage());
    // The second read fails with invalid_cursor; the third is the first page again (no cursor).
    await waitFor(() => expect(served.titles).toHaveLength(3));
    expect(served.titles[2]!.url.searchParams.has('cursor')).toBe(false);
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(client.getQueryData([...key, 'neighbour'])).toBe('kept');
    // Nothing else was reset either: the capabilities were read once.
    expect(served.capabilities).toHaveLength(1);
  });

  it('keeps the error of any other failure on the next page and does not restart', async () => {
    const served = serve({
      titles: (seen) => {
        if (seen.length === 2) return problem(500, 'boom');
        return HttpResponse.json({
          items: matches('Title', 1),
          total: 2,
          total_exact: true,
          window_cursor: 'w',
          page: { has_more: true, next_cursor: 'c2' },
        } satisfies S['CatalogBrowseCollection']);
      },
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchTitles('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    await tick(450);
    expect(served.titles).toHaveLength(2);
    expect(result.current.data?.pages).toHaveLength(1);
  });
});

describe('useSearchBoxSets', () => {
  const withBoxSets = { box_sets: true };

  it('reads the matching box sets, four at most, after the quiet period', async () => {
    const served = serve({
      capabilities: withBoxSets,
      boxSets: () => HttpResponse.json({ items: [boxSet('b1'), boxSet('b2')] }),
    });
    const { wrapper, client } = harness('p1');
    const quiet = holdQuietPeriod();
    const { result } = renderHook(() => useSearchBoxSets('abc', 'all'), { wrapper });
    await waitFor(() => expect(served.capabilities).toHaveLength(1));
    await quiet.rest(() => served.boxSets.length);
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(served.boxSets).toHaveLength(1);
    expect(paramsOf(served.boxSets[0]!.url)).toEqual({ q: 'abc', limit: '4' });
    expect(served.boxSets[0]!.profile).toBe('p1');
    expect(result.current.items.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(client.getQueryData(['search', 'boxsets', BASE_URL, 'p1', 'abc'])).toBeDefined();
  });

  it('reports loading while the read is out', async () => {
    serve({ capabilities: withBoxSets });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchBoxSets('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('offers none for an empty query, for Series and for a server without box sets', async () => {
    const served = serve({ capabilities: withBoxSets });
    const { wrapper } = harness();
    const empty = renderHook(() => useSearchBoxSets('', 'all'), { wrapper });
    const series = renderHook(() => useSearchBoxSets('abc', 'series'), { wrapper });
    await tick();
    expect(empty.result.current).toEqual({ items: [], loading: false });
    expect(series.result.current).toEqual({ items: [], loading: false });
    expect(served.boxSets).toHaveLength(0);

    server.resetHandlers();
    const plain = serve({ capabilities: { box_sets: false } });
    const none = renderHook(() => useSearchBoxSets('abc', 'all'), { wrapper: harness().wrapper });
    await tick();
    expect(none.result.current).toEqual({ items: [], loading: false });
    expect(plain.boxSets).toHaveLength(0);
  });

  it('drops the items when the segment no longer wants them, though they are cached', async () => {
    serve({
      capabilities: withBoxSets,
      boxSets: () => HttpResponse.json({ items: [boxSet('b1')] }),
    });
    const { wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ segment }: { segment: Segment }) => useSearchBoxSets('abc', segment),
      { wrapper, initialProps: { segment: 'all' as Segment } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    rerender({ segment: 'series' });
    expect(result.current).toEqual({ items: [], loading: false });
  });

  it('keeps the previous box sets on screen while a new query is read', async () => {
    serve({
      capabilities: withBoxSets,
      boxSets: (seen) => HttpResponse.json({ items: [boxSet(`b${seen.length}`)] }),
    });
    const { wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useSearchBoxSets(query, 'all'),
      { wrapper, initialProps: { query: 'abc' } },
    );
    await waitFor(() => expect(result.current.items.map((b) => b.id)).toEqual(['b1']));
    rerender({ query: 'abcd' });
    expect(result.current.items.map((b) => b.id)).toEqual(['b1']);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items.map((b) => b.id)).toEqual(['b2']));
  });

  it('shows no box sets for a failed read, asks once, and throws a SiloApiError inside', async () => {
    const served = serve({ capabilities: withBoxSets, boxSets: () => problem(500, 'boom') });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSearchBoxSets('abc', 'all'), { wrapper });
    await waitFor(() => expect(served.boxSets).toHaveLength(1));
    await waitFor(() =>
      expect(client.getQueryState(['search', 'boxsets', BASE_URL, 'p1', 'abc'])?.status).toBe(
        'error',
      ),
    );
    await tick(150);
    expect(served.boxSets).toHaveLength(1);
    expect(result.current.items).toEqual([]);
    expect(
      client.getQueryState(['search', 'boxsets', BASE_URL, 'p1', 'abc'])?.error,
    ).toBeInstanceOf(SiloApiError);
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve({ capabilities: withBoxSets });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSearchBoxSets('abc', 'all'), { wrapper });
    await waitFor(() =>
      expect(client.getQueryData(['search', 'boxsets', BASE_URL, '', 'abc'])).toEqual([]),
    );
    expect(result.current.items).toEqual([]);
  });
});

describe('useSearchPeople', () => {
  const withPeople = { people_media_scope: true };

  it('reads the matching people in the titles scope, twelve at most', async () => {
    const served = serve({
      capabilities: withPeople,
      people: () =>
        HttpResponse.json({ items: [personMatch({ id: 'a' }), personMatch({ id: 'b' })] }),
    });
    const { wrapper, client } = harness('p1');
    const quiet = holdQuietPeriod();
    const { result } = renderHook(() => useSearchPeople('abc', 'all'), { wrapper });
    await waitFor(() => expect(served.capabilities).toHaveLength(1));
    await quiet.rest(() => served.people.length);
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(paramsOf(served.people[0]!.url)).toEqual({
      q: 'abc',
      limit: '12',
      media_scope: 'video',
    });
    expect(served.people[0]!.profile).toBe('p1');
    expect(result.current.items.map((p) => p.id)).toEqual(['a', 'b']);
    expect(client.getQueryData(['search', 'people', BASE_URL, 'p1', 'abc', 'video'])).toBeDefined();
  });

  it('widens the scope to episodes where the server can', async () => {
    const served = serve({
      capabilities: { people_media_scope: true, video_with_episodes_scope: true },
    });
    const { wrapper, client } = harness('p1');
    renderHook(() => useSearchPeople('abc', 'all'), { wrapper });
    await waitFor(() => expect(served.people).toHaveLength(1));
    expect(served.people[0]!.url.searchParams.get('media_scope')).toBe('video_with_episodes');
    await waitFor(() =>
      expect(
        client.getQueryData(['search', 'people', BASE_URL, 'p1', 'abc', 'video_with_episodes']),
      ).toEqual([]),
    );
  });

  it('reports loading while the read is out', async () => {
    serve({ capabilities: withPeople });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSearchPeople('abc', 'all'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('offers none for an empty query, for Movies and Series, and for a server without people', async () => {
    const served = serve({ capabilities: withPeople });
    const { wrapper } = harness();
    const empty = renderHook(() => useSearchPeople('', 'all'), { wrapper });
    const movies = renderHook(() => useSearchPeople('abc', 'movies'), { wrapper });
    await tick();
    expect(empty.result.current).toEqual({ items: [], loading: false });
    expect(movies.result.current).toEqual({ items: [], loading: false });
    expect(served.people).toHaveLength(0);

    server.resetHandlers();
    const plain = serve({ capabilities: { people_media_scope: false } });
    const none = renderHook(() => useSearchPeople('abc', 'all'), { wrapper: harness().wrapper });
    await tick();
    expect(none.result.current).toEqual({ items: [], loading: false });
    expect(plain.people).toHaveLength(0);
  });

  it('drops the items when the segment no longer wants them, though they are cached', async () => {
    serve({
      capabilities: withPeople,
      people: () => HttpResponse.json({ items: [personMatch()] }),
    });
    const { wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ segment }: { segment: Segment }) => useSearchPeople('abc', segment),
      { wrapper, initialProps: { segment: 'all' as Segment } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    rerender({ segment: 'movies' });
    expect(result.current).toEqual({ items: [], loading: false });
  });

  it('shows no people for a failed read, asks once, and throws a SiloApiError inside', async () => {
    const served = serve({ capabilities: withPeople, people: () => problem(500, 'boom') });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSearchPeople('abc', 'all'), { wrapper });
    const key = ['search', 'people', BASE_URL, 'p1', 'abc', 'video'];
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('error'));
    await tick(150);
    expect(served.people).toHaveLength(1);
    expect(result.current.items).toEqual([]);
    expect(client.getQueryState(key)?.error).toBeInstanceOf(SiloApiError);
  });

  it('keeps the previous people while a new query is read, and keys a signed-out read with an empty profile', async () => {
    serve({
      capabilities: withPeople,
      people: (seen) => HttpResponse.json({ items: [personMatch({ id: `p${seen.length}` })] }),
    });
    const { wrapper, client } = harness(null);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useSearchPeople(query, 'all'),
      { wrapper, initialProps: { query: 'abc' } },
    );
    await waitFor(() => expect(result.current.items.map((p) => p.id)).toEqual(['p1']));
    expect(client.getQueryData(['search', 'people', BASE_URL, '', 'abc', 'video'])).toBeDefined();
    rerender({ query: 'abcd' });
    expect(result.current.items.map((p) => p.id)).toEqual(['p1']);
    await waitFor(() => expect(result.current.items.map((p) => p.id)).toEqual(['p2']));
  });
});
