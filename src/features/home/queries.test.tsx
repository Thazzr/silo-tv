// The Home reads and the section grid, pinned request by request: path, query, header, cache key,
// paging and the mapping of the answer. A failed read must throw a SiloApiError.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { components } from '../../api/generated/schema';
import { SiloApiError } from '../../api/problem';
import { Session } from '../../api/session';
import { SiloProvider } from '../../app/SiloContext';
import { BASE_URL, account } from '../../test/apiFixtures';
import { catalogItem, catalogPage } from '../../test/flowFixtures';
import { homeCapabilities, homeSection } from '../../test/homeFixtures';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import {
  GRID_PAGE_SIZE,
  ROW_ITEM_LIMIT,
  itemLimitFor,
  useDismissItem,
  useHomeCapabilities,
  useHomeSections,
  useSectionLimits,
  useSectionPages,
  useSectionReader,
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

const CAPABILITIES_KEY = ['home', 'capabilities', BASE_URL];

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

type Reply = Record<string, unknown> | null;

const failure = () =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Boom', status: 500, code: 'boom' },
    { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
  );

/** Answers one route with `answer` (or a 500) and records what came in. */
function serve(
  method: 'get' | 'put',
  path: string,
  answer: Reply | ((seen: Seen[]) => Reply),
  options: { fail?: boolean } = {},
): Seen[] {
  const seen: Seen[] = [];
  const handler = async ({ request }: { request: Request }) => {
    let body: unknown;
    if (method === 'put') body = await request.json();
    seen.push({
      url: new URL(request.url),
      profile: request.headers.get('X-Profile-Id'),
      body,
    });
    if (options.fail) return failure();
    if (method === 'put') return new HttpResponse(null, { status: 204 });
    return HttpResponse.json(typeof answer === 'function' ? answer(seen) : answer);
  };
  server.use(http[method](`${BASE_URL}${path}`, handler));
  return seen;
}

const paramsOf = (url: URL) => Object.fromEntries(url.searchParams.entries());
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('constants and itemLimitFor', () => {
  it('pins the row and grid sizes', () => {
    expect(ROW_ITEM_LIMIT).toBe(20);
    expect(GRID_PAGE_SIZE).toBe(40);
  });

  it('sends no limit when the server names none or a nonsensical one', () => {
    expect(itemLimitFor(undefined)).toBeUndefined();
    expect(itemLimitFor(0)).toBeUndefined();
    expect(itemLimitFor(-5)).toBeUndefined();
  });

  it('cuts the row maximum to what the server accepts', () => {
    expect(itemLimitFor(1)).toBe(1);
    expect(itemLimitFor(2)).toBe(2);
    expect(itemLimitFor(15)).toBe(15);
    expect(itemLimitFor(20)).toBe(20);
    expect(itemLimitFor(100)).toBe(20);
  });
});

describe('useSectionLimits', () => {
  it('reads the limits from the cache only, per kind, and none before the capabilities are cached', () => {
    const { wrapper, client } = harness();
    const { result } = renderHook(() => useSectionLimits(), { wrapper });
    expect(result.current()).toEqual({ sectionLimit: undefined, rowLimit: undefined });
    client.setQueryData(
      CAPABILITIES_KEY,
      homeCapabilities({ section_item_limit_max: 7, row_item_limit_max: 100 }),
    );
    expect(result.current()).toEqual({ sectionLimit: 7, rowLimit: 20 });
  });
});

describe('useHomeCapabilities', () => {
  it('reads the capabilities once per server, with the profile, under the server key', async () => {
    const seen = serve('get', '/api/v2/home/capabilities', homeCapabilities());
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useHomeCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.profile).toBe('p1');
    expect(client.getQueryData(CAPABILITIES_KEY)).toBe(result.current.data);
    expect(result.current.data?.row_item_limit_max).toBe(100);
    // Kept for the session: an answer never goes stale and is never dropped.
    const again = renderHook(() => useHomeCapabilities(), { wrapper });
    await tick();
    expect(again.result.current.data).toBe(result.current.data);
    expect(seen).toHaveLength(1);
  });

  it('throws a SiloApiError on a failed read and does not ask again', async () => {
    const seen = serve('get', '/api/v2/home/capabilities', null, { fail: true });
    const { wrapper } = harness();
    const { result } = renderHook(() => useHomeCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect((result.current.error as SiloApiError).code).toBe('boom');
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('survives a signed-out session', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    const { wrapper } = harness(null);
    const { result } = renderHook(() => useHomeCapabilities(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useHomeSections', () => {
  it('reads the sections without an item limit while the capabilities are not cached', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    const seen = serve('get', '/api/v2/home/sections', { sections: [homeSection('a')] });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useHomeSections(), { wrapper });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual(ROW_IMAGES);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.profileId).toBe('p1');
    expect(result.current.query.data?.map((s) => s.id)).toEqual(['a']);
    expect(client.getQueryData(['home', 'sections', BASE_URL, 'p1'])).toBe(
      result.current.query.data,
    );
  });

  it('carries the cached section limit and reports the row limit', async () => {
    const seen = serve('get', '/api/v2/home/sections', { sections: [] });
    const { wrapper, client } = harness('p1');
    client.setQueryData(
      CAPABILITIES_KEY,
      homeCapabilities({ section_item_limit_max: 12, row_item_limit_max: 8 }),
    );
    const { result } = renderHook(() => useHomeSections(), { wrapper });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({ item_limit: '12', ...ROW_IMAGES });
    expect(result.current.rowLimit).toBe(8);
  });

  it('has no row limit when the capabilities did not say one', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    serve('get', '/api/v2/home/sections', { sections: [] });
    const { wrapper } = harness();
    const { result } = renderHook(() => useHomeSections(), { wrapper });
    expect(result.current.rowLimit).toBeUndefined();
    await waitFor(() => expect(result.current.rowLimit).toBe(20));
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    serve('get', '/api/v2/home/sections', { sections: [] });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useHomeSections(), { wrapper });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.profileId).toBe('');
    expect(client.getQueryData(['home', 'sections', BASE_URL, ''])).toEqual([]);
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('get', '/api/v2/home/capabilities', homeCapabilities());
    serve('get', '/api/v2/home/sections', null, { fail: true });
    const { wrapper } = harness();
    const { result } = renderHook(() => useHomeSections(), { wrapper });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.query.error).toBeInstanceOf(SiloApiError);
  });
});

describe('useSectionReader', () => {
  it('reads one section again with the row limit and the image query', async () => {
    const seen = serve('get', '/api/v2/home/sections/s1/items', homeSection('s1', 2));
    const { wrapper } = harness('p1');
    const { result } = renderHook(() => useSectionReader(9), { wrapper });
    const section = await result.current('s1');
    expect(section.id).toBe('s1');
    expect(section.items).toHaveLength(2);
    expect(paramsOf(seen[0]!.url)).toEqual({ item_limit: '9', ...ROW_IMAGES });
    expect(seen[0]!.profile).toBe('p1');
  });

  it('sends no limit when none is known', async () => {
    const seen = serve('get', '/api/v2/home/sections/s1/items', homeSection('s1', 1));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSectionReader(undefined), { wrapper });
    await result.current('s1');
    expect(paramsOf(seen[0]!.url)).toEqual(ROW_IMAGES);
  });

  it('throws a SiloApiError when the read fails', async () => {
    serve('get', '/api/v2/home/sections/s1/items', null, { fail: true });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSectionReader(undefined), { wrapper });
    await expect(result.current('s1')).rejects.toBeInstanceOf(SiloApiError);
  });
});

describe('useDismissItem', () => {
  const resumed = catalogItem({
    content_id: 'ep-1',
    series_id: 'ser-1',
    progress_updated_at: '2026-01-02T03:04:05.000Z',
  });

  it('hides a Continue Watching card until it is played again', async () => {
    const seen = serve('put', '/api/v2/home/dismissals/continue_watching/ep-1', null);
    const { wrapper } = harness('p1');
    const { result } = renderHook(() => useDismissItem(), { wrapper });
    await act(() => result.current.mutateAsync({ surface: 'continue_watching', item: resumed }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toEqual({ progress_updated_at: '2026-01-02T03:04:05.000Z' });
    expect(seen[0]!.profile).toBe('p1');
  });

  it('drops the series from Next Up, falling back to the item itself', async () => {
    const seen = serve('put', '/api/v2/home/dismissals/next_up/:id', null);
    const { wrapper } = harness();
    const { result } = renderHook(() => useDismissItem(), { wrapper });
    await act(() => result.current.mutateAsync({ surface: 'next_up', item: resumed }));
    const noSeries = catalogItem({ content_id: 'm-9' });
    await act(() => result.current.mutateAsync({ surface: 'next_up', item: noSeries }));
    expect(seen.map((s) => s.url.pathname)).toEqual([
      '/api/v2/home/dismissals/next_up/ep-1',
      '/api/v2/home/dismissals/next_up/m-9',
    ]);
    expect(seen.map((s) => s.body)).toEqual([{ series_id: 'ser-1' }, { series_id: 'm-9' }]);
  });

  it('throws a SiloApiError when the server refuses', async () => {
    serve('put', '/api/v2/home/dismissals/next_up/ep-1', null, { fail: true });
    const { wrapper } = harness();
    const { result } = renderHook(() => useDismissItem(), { wrapper });
    await expect(
      act(() => result.current.mutateAsync({ surface: 'next_up', item: resumed })),
    ).rejects.toBeInstanceOf(SiloApiError);
  });
});

describe('useSectionPages', () => {
  const page = (items: S['CatalogItem'][], next?: string): S['CatalogBrowseCollection'] => ({
    ...catalogPage(items),
    ...(next ? { page: { has_more: true, next_cursor: next } } : { page: { has_more: false } }),
  });

  it('reads a Home section as the home scope, 40 at a time, and follows the cursor', async () => {
    const seen = serve('get', '/api/v2/catalog', (all) =>
      all.length === 1
        ? page([catalogItem({ content_id: 'a' })], 'c2')
        : page([catalogItem({ content_id: 'b' })]),
    );
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSectionPages('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({
      source: 'section',
      scope: 'home',
      section_id: 's1',
      limit: '40',
      ...GRID_IMAGES,
    });
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.hasNextPage).toBe(true);
    expect(
      client.getQueryData(['home', 'section-pages', BASE_URL, 'p1', 's1', '', '']),
    ).toBeDefined();

    await act(() => result.current.fetchNextPage());
    expect(seen).toHaveLength(2);
    expect(seen[1]!.url.searchParams.get('cursor')).toBe('c2');
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.data?.pages.flatMap((p) => p.items.map((i) => i.content_id))).toEqual([
      'a',
      'b',
    ]);
  });

  it('reads a library row in the library scope, with its kind for a mixed library', async () => {
    const seen = serve('get', '/api/v2/catalog', page([]));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSectionPages('s1', { id: 'lib-1', type: 'movie' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({
      source: 'section',
      scope: 'library',
      section_id: 's1',
      library_id: 'lib-1',
      type: 'movie',
      limit: '40',
      ...GRID_IMAGES,
    });
    expect(
      client.getQueryData(['home', 'section-pages', BASE_URL, 'p1', 's1', 'lib-1', 'movie']),
    ).toBeDefined();
  });

  it('sends no type for a library without one', async () => {
    const seen = serve('get', '/api/v2/catalog', page([]));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSectionPages('s1', { id: 'lib-1' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen[0]!.url.searchParams.has('type')).toBe(false);
    expect(seen[0]!.url.searchParams.get('library_id')).toBe('lib-1');
    expect(
      client.getQueryData(['home', 'section-pages', BASE_URL, 'p1', 's1', 'lib-1', '']),
    ).toBeDefined();
  });

  it('has no next page without paging info, and keys a signed-out read with an empty profile', async () => {
    serve('get', '/api/v2/catalog', catalogPage([]));
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSectionPages('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
    expect(
      client.getQueryData(['home', 'section-pages', BASE_URL, '', 's1', '', '']),
    ).toBeDefined();
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('get', '/api/v2/catalog', null, { fail: true });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSectionPages('s1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
  });
});
