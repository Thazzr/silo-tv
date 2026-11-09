// Typed fixtures and an MSW harness for the Search tab, typed against the generated schema like
// the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { catalogItem } from './flowFixtures';

type S = components['schemas'];

/** `n` movie cards "<prefix> 1".."<prefix> n". */
export function matches(prefix: string, n: number, from = 1): S['CatalogItem'][] {
  return Array.from({ length: n }, (_, i) =>
    catalogItem({
      content_id: `${prefix.toLowerCase()}-${from + i}`,
      title: `${prefix} ${from + i}`,
      type: 'movie',
      year: 2000 + from + i,
    }),
  );
}

/** An episode result: its series, season and episode numbers and its own title. */
export function episodeMatch(overrides: Partial<S['CatalogItem']> = {}): S['CatalogItem'] {
  return catalogItem({
    content_id: 'ep-1',
    type: 'episode',
    title: 'The Pilot',
    series_id: 'ser-1',
    series_title: 'Sagas of Old',
    season_number: 1,
    episode_number: 2,
    ...overrides,
  });
}

export function personMatch(overrides: Partial<S['Person']> = {}): S['Person'] {
  return { id: 'pers-1', name: 'Sage Actor', ...overrides };
}

export interface SearchRead {
  query: URLSearchParams;
  /** The signal of the request as the server saw it; aborted once the app cancelled it. */
  signal: AbortSignal;
}

export interface SearchCalls {
  titles: SearchRead[];
  boxSets: SearchRead[];
  people: SearchRead[];
  capabilities: number;
}

export interface SearchServe {
  /** What the capabilities say; none are on unless given. `fail` is a 500. */
  capabilities?: Partial<S['CatalogSearchCapabilities']> | 'fail';
  /** The titles that match a request, in order; they are paged by the cursor. `fail` is a 500. */
  titles?: (query: URLSearchParams) => S['CatalogItem'][] | 'fail';
  /** The box sets that match a request; `fail` is a 500. */
  boxSets?: (query: URLSearchParams) => S['CatalogBoxSet'][] | 'fail';
  /** The people that match a request; `fail` is a 500. */
  people?: (query: URLSearchParams) => S['Person'][] | 'fail';
  /** What the server says about the total; exact unless given. */
  totalExact?: boolean;
  /** Answers the first titles read only after this promise. */
  holdTitles?: Promise<void>;
  /** Answers the page after this cursor with `invalid_cursor` the first time it is asked for. */
  staleCursorAfter?: string;
  pageSize?: number;
}

const PAGE = 40;

/** Registers the search endpoints; the returned object records what the app asked for. */
export function serveSearch(server: SetupServer, options: SearchServe = {}): SearchCalls {
  const calls: SearchCalls = { titles: [], boxSets: [], people: [], capabilities: 0 };
  let staleSent = false;
  const list = <T>(items: T[] | 'fail') =>
    items === 'fail' ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ items });
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/search/capabilities`, () => {
      calls.capabilities += 1;
      if (options.capabilities === 'fail') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({
        allowed: true,
        revision: 'r1',
        state: 'available',
        ...options.capabilities,
      } satisfies S['CatalogSearchCapabilities']);
    }),
    http.get(`${BASE_URL}/api/v2/catalog/box-sets`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.boxSets.push({ query, signal: request.signal });
      return list(options.boxSets?.(query) ?? []);
    }),
    http.get(`${BASE_URL}/api/v2/catalog/people`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.people.push({ query, signal: request.signal });
      return list(options.people?.(query) ?? []);
    }),
    http.get(`${BASE_URL}/api/v2/catalog`, async ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.titles.push({ query, signal: request.signal });
      if (options.holdTitles && calls.titles.length === 1) await options.holdTitles;
      const all = options.titles ? options.titles(query) : matches('Title', 3);
      if (all === 'fail') return new HttpResponse(null, { status: 500 });
      const size = options.pageSize ?? PAGE;
      const cursor = query.get('cursor');
      if (cursor !== null && cursor === options.staleCursorAfter && !staleSent) {
        staleSent = true;
        return HttpResponse.json(
          { code: 'invalid_cursor', title: 'The cursor is no longer valid', status: 400 },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      const start = Number(cursor ?? 0);
      const more = start + size < all.length;
      return HttpResponse.json({
        items: all.slice(start, start + size),
        total: all.length,
        total_exact: options.totalExact ?? true,
        window_cursor: 'w',
        page: more ? { has_more: true, next_cursor: String(start + size) } : { has_more: false },
      } satisfies S['CatalogBrowseCollection']);
    }),
  );
  return calls;
}
