// The detail reads, pinned request by request: path, query, header, cache key, mapping of the
// answer, retry and refetch rules, and that a failed read throws a SiloApiError.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SiloApiError } from '../../api/problem';
import { Session } from '../../api/session';
import { SiloProvider } from '../../app/SiloContext';
import { BASE_URL, account } from '../../test/apiFixtures';
import { episodeOf, itemDetail, seasonOf } from '../../test/detailFixtures';
import { catalogItem } from '../../test/flowFixtures';
import { memoryStorage, testDevice } from '../../test/renderFlow';
import {
  BOXSET_ROW_LIMIT,
  CAST_LIMIT,
  DETAIL_IMAGE_QUERY,
  SIMILAR_LIMIT,
  itemDetailKey,
  retryUnlessMissing,
  seasonEpisodesKey,
  useItemDetail,
  useSeasonEpisodes,
  useSeasons,
  useSimilar,
} from './queries';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** What every detail read asks for in its image query, spelled out so a width change shows up. */
const IMAGE_PARAMS = {
  poster_width: '352',
  backdrop_width: '1920',
  logo_width: '880',
  still_width: '720',
  photo_width: '352',
};

function harness(profileId: string | null = 'p1', queryClient?: QueryClient) {
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
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, refetchOnWindowFocus: false, retryDelay: 0 } },
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
}

/** Answers `path` with `answer` (or a 500 problem) and records every request. */
function serve(path: string, answer: Record<string, unknown> | 'fail' | 'missing'): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http.get(`${BASE_URL}${path}`, ({ request }) => {
      seen.push({ url: new URL(request.url), profile: request.headers.get('X-Profile-Id') });
      if (answer === 'fail') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Boom', status: 500, code: 'boom' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      if (answer === 'missing') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 404 },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      return HttpResponse.json(answer);
    }),
  );
  return seen;
}

const paramsOf = (url: URL) => Object.fromEntries(url.searchParams.entries());

describe('constants and keys', () => {
  it('pins the limits and the image widths of the detail reads', () => {
    expect(SIMILAR_LIMIT).toBe(12);
    expect(BOXSET_ROW_LIMIT).toBe(20);
    expect(CAST_LIMIT).toBe(24);
    expect(DETAIL_IMAGE_QUERY).toEqual({
      poster_width: 352,
      backdrop_width: 1920,
      logo_width: 880,
      still_width: 720,
      photo_width: 352,
    });
  });

  it('builds the item and season keys the translation run polls', () => {
    expect(itemDetailKey('https://s', 'p1', 'm1')).toEqual([
      'detail',
      'item',
      'https://s',
      'p1',
      'm1',
    ]);
    expect(seasonEpisodesKey('https://s', 'p1', 'ser', 2)).toEqual([
      'detail',
      'episodes',
      'https://s',
      'p1',
      'ser',
      2,
    ]);
    // An unknown season has its own slot, apart from season 0 (the specials).
    expect(seasonEpisodesKey('https://s', 'p1', 'ser', undefined)).toEqual([
      'detail',
      'episodes',
      'https://s',
      'p1',
      'ser',
      -1,
    ]);
    expect(seasonEpisodesKey('https://s', 'p1', 'ser', 0)[5]).toBe(0);
  });
});

describe('retryUnlessMissing', () => {
  const api = (status: number) => new SiloApiError({ status });

  it('never retries a title that is gone', () => {
    expect(retryUnlessMissing(0, api(404))).toBe(false);
    expect(retryUnlessMissing(1, api(404))).toBe(false);
  });

  it('retries any other failure exactly once', () => {
    expect(retryUnlessMissing(0, api(500))).toBe(true);
    expect(retryUnlessMissing(1, api(500))).toBe(false);
    expect(retryUnlessMissing(2, api(500))).toBe(false);
    expect(retryUnlessMissing(0, new Error('offline'))).toBe(true);
    expect(retryUnlessMissing(0, null)).toBe(true);
    expect(retryUnlessMissing(0, undefined)).toBe(true);
  });

  it('only a SiloApiError counts as "gone"', () => {
    expect(retryUnlessMissing(0, { status: 404 })).toBe(true);
  });
});

describe('useItemDetail', () => {
  it('reads the item with the image query and the profile, under its key', async () => {
    const seen = serve('/api/v2/catalog/items/m1', itemDetail({ content_id: 'm1' }));
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toHaveLength(1);
    expect(paramsOf(seen[0]!.url)).toEqual(IMAGE_PARAMS);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.content_id).toBe('m1');
    expect(client.getQueryData(['detail', 'item', BASE_URL, 'p1', 'm1'])).toBe(result.current.data);
  });

  it('keys a signed-out read with an empty profile instead of throwing', async () => {
    serve('/api/v2/catalog/items/m1', itemDetail());
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['detail', 'item', BASE_URL, '', 'm1'])).toBeDefined();
  });

  it('throws the server problem as a SiloApiError, and asks a second time for a 500', async () => {
    const seen = serve('/api/v2/catalog/items/m1', 'fail');
    const { wrapper } = harness();
    const { result } = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect((result.current.error as SiloApiError).status).toBe(500);
    expect((result.current.error as SiloApiError).code).toBe('boom');
    expect(seen).toHaveLength(2);
  });

  it('does not ask again for a title that is gone', async () => {
    const seen = serve('/api/v2/catalog/items/m1', 'missing');
    const { wrapper } = harness();
    const { result } = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as SiloApiError).status).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it('reads the watch state again when the page is mounted again, even from a fresh cache', async () => {
    const seen = serve('/api/v2/catalog/items/m1', itemDetail());
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } },
    });
    const { wrapper } = harness('p1', client);
    const first = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const second = renderHook(() => useItemDetail('m1'), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(2));
    second.unmount();
  });
});

describe('useSeasons', () => {
  it('reads the seasons of a series and returns the items', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons', {
      items: [seasonOf(1), seasonOf(2)],
    });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSeasons('ser1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual(IMAGE_PARAMS);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.map((s) => s.season_number)).toEqual([1, 2]);
    expect(client.getQueryData(['detail', 'seasons', BASE_URL, 'p1', 'ser1'])).toBe(
      result.current.data,
    );
  });

  it('sends nothing while disabled', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons', { items: [] });
    const { wrapper } = harness();
    const { result } = renderHook(() => useSeasons('ser1', false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe('idle');
    expect(seen).toHaveLength(0);
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve('/api/v2/catalog/series/ser1/seasons', { items: [] });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSeasons('ser1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['detail', 'seasons', BASE_URL, '', 'ser1'])).toEqual([]);
  });

  it('throws a SiloApiError on a failed read, retrying once, but not on a 404', async () => {
    const failing = serve('/api/v2/catalog/series/ser1/seasons', 'fail');
    const a = renderHook(() => useSeasons('ser1', true), { wrapper: harness().wrapper });
    await waitFor(() => expect(a.result.current.isError).toBe(true));
    expect(a.result.current.error).toBeInstanceOf(SiloApiError);
    expect(failing).toHaveLength(2);

    server.resetHandlers();
    const gone = serve('/api/v2/catalog/series/ser1/seasons', 'missing');
    const b = renderHook(() => useSeasons('ser1', true), { wrapper: harness().wrapper });
    await waitFor(() => expect(b.result.current.isError).toBe(true));
    expect((b.result.current.error as SiloApiError).status).toBe(404);
    expect(gone).toHaveLength(1);
  });

  it('reads again on mount even though the cached answer is fresh', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons', { items: [seasonOf(1)] });
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } },
    });
    const { wrapper } = harness('p1', client);
    const first = renderHook(() => useSeasons('ser1', true), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    renderHook(() => useSeasons('ser1', true), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(2));
  });
});

describe('useSeasonEpisodes', () => {
  it('reads the episodes of one season by its number', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons/2/episodes', {
      items: [episodeOf(2, 1), episodeOf(2, 2)],
    });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSeasonEpisodes('ser1', 2), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual(IMAGE_PARAMS);
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data).toHaveLength(2);
    expect(client.getQueryData(['detail', 'episodes', BASE_URL, 'p1', 'ser1', 2])).toBe(
      result.current.data,
    );
  });

  it('reads season 0 (the specials) and waits for an unknown season', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons/0/episodes', {
      items: [episodeOf(0, 1)],
    });
    const { wrapper } = harness();
    const zero = renderHook(() => useSeasonEpisodes('ser1', 0), { wrapper });
    await waitFor(() => expect(zero.result.current.isSuccess).toBe(true));
    expect(seen).toHaveLength(1);

    const none = renderHook(() => useSeasonEpisodes('ser1', undefined), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(none.result.current.fetchStatus).toBe('idle');
    expect(seen).toHaveLength(1);
  });

  it('keys a signed-out read with an empty profile', async () => {
    serve('/api/v2/catalog/series/ser1/seasons/1/episodes', { items: [] });
    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['detail', 'episodes', BASE_URL, '', 'ser1', 1])).toEqual([]);
  });

  it('throws a SiloApiError on a failed read', async () => {
    serve('/api/v2/catalog/series/ser1/seasons/1/episodes', 'fail');
    const { wrapper } = harness();
    const { result } = renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
  });

  it('does not retry a 404 and reads again on mount', async () => {
    const gone = serve('/api/v2/catalog/series/ser1/seasons/1/episodes', 'missing');
    const a = renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper: harness().wrapper });
    await waitFor(() => expect(a.result.current.isError).toBe(true));
    expect(gone).toHaveLength(1);

    server.resetHandlers();
    const seen = serve('/api/v2/catalog/series/ser1/seasons/1/episodes', { items: [] });
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } },
    });
    const { wrapper } = harness('p1', client);
    const first = renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper });
    await waitFor(() => expect(seen).toHaveLength(2));
  });

  it('retries a 500 once', async () => {
    const seen = serve('/api/v2/catalog/series/ser1/seasons/1/episodes', 'fail');
    const { wrapper } = harness();
    const { result } = renderHook(() => useSeasonEpisodes('ser1', 1), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(seen).toHaveLength(2);
  });
});

describe('useSimilar', () => {
  it('asks for twelve titles with the image query, under its key', async () => {
    const seen = serve('/api/v2/recommendations/similar/m1', {
      items: [catalogItem({ content_id: 'x1' })],
    });
    const { wrapper, client } = harness('p1');
    const { result } = renderHook(() => useSimilar('m1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(paramsOf(seen[0]!.url)).toEqual({ limit: '12', ...IMAGE_PARAMS });
    expect(seen[0]!.profile).toBe('p1');
    expect(result.current.data?.map((i) => i.content_id)).toEqual(['x1']);
    expect(client.getQueryData(['detail', 'similar', BASE_URL, 'p1', 'm1'])).toBe(
      result.current.data,
    );
  });

  it('sends nothing while disabled, and keys a signed-out read with an empty profile', async () => {
    const seen = serve('/api/v2/recommendations/similar/m1', { items: [] });
    const off = renderHook(() => useSimilar('m1', false), { wrapper: harness().wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(off.result.current.fetchStatus).toBe('idle');
    expect(seen).toHaveLength(0);

    const { wrapper, client } = harness(null);
    const { result } = renderHook(() => useSimilar('m1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['detail', 'similar', BASE_URL, '', 'm1'])).toEqual([]);
  });

  it('throws a SiloApiError and does not retry', async () => {
    const seen = serve('/api/v2/recommendations/similar/m1', 'fail');
    const { wrapper } = harness();
    const { result } = renderHook(() => useSimilar('m1', true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(SiloApiError);
    expect(seen).toHaveLength(1);
  });
});
