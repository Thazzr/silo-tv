// Typed fixtures and an MSW harness for the Home screen and the row grids, typed against the
// generated schema like the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { catalogItem } from './flowFixtures';

type S = components['schemas'];

export function homeCapabilities(
  overrides: Partial<S['HomeCapabilities']> = {},
): S['HomeCapabilities'] {
  return {
    allowed: true,
    revision: 'r1',
    row_item_limit_max: 100,
    section_item_limit_max: 100,
    state: 'available',
    ...overrides,
  };
}

/** A section with `count` movies called "<id> 1", "<id> 2" and so on. */
export function homeSection(
  id: string,
  count = 3,
  overrides: Partial<S['Section']> = {},
): S['Section'] {
  const items = Array.from({ length: count }, (_, i) =>
    catalogItem({
      content_id: `${id}-${i + 1}`,
      title: `${id} ${i + 1}`,
      year: 2000 + i,
      poster_url: `/img/${id}-${i + 1}-poster.webp`,
      backdrop_url: `/img/${id}-${i + 1}-backdrop.webp`,
    }),
  );
  return {
    customized: false,
    featured: false,
    id,
    is_custom: false,
    item_limit: 20,
    items,
    section_type: 'recently_added',
    title: `Row ${id}`,
    total_count: count,
    ...overrides,
  };
}

/** An episode card of Continue Watching, half way through. */
export function resumeEpisode(
  id: string,
  overrides: Partial<S['CatalogItem']> = {},
): S['CatalogItem'] {
  return catalogItem({
    content_id: id,
    type: 'episode',
    title: `Pilot ${id}`,
    series_title: `Show ${id}`,
    series_id: `series-${id}`,
    season_number: 1,
    episode_number: 3,
    position_seconds: 600,
    duration_seconds: 2400,
    item_source: 'in_progress',
    progress_updated_at: '2026-01-02T03:04:05.000Z',
    backdrop_url: `/img/${id}-backdrop.webp`,
    series_backdrop_url: `/img/${id}-series-backdrop.webp`,
    year: undefined,
    ...overrides,
  });
}

export interface HomeCalls {
  capabilities: number;
  /** The query strings of the list reads. */
  lists: URLSearchParams[];
  /** Section ids of the single-row reads. */
  rows: { id: string; query: URLSearchParams }[];
  /** `surface/item` of each dismissal, with its body. */
  dismissals: { path: string; body: unknown }[];
  /** The query strings of the catalog (grid) reads. */
  pages: URLSearchParams[];
}

export interface HomeServe {
  capabilities?: S['HomeCapabilities'] | 'fail';
  sections?: S['Section'][] | 'fail';
  /** Answers a single-row read; defaults to the section of the list. */
  row?: (id: string, calls: HomeCalls) => Response | undefined;
  /** Answers a catalog page of a row. */
  page?: (
    params: URLSearchParams,
    calls: HomeCalls,
  ) => S['CatalogBrowseCollection'] | Response | Promise<S['CatalogBrowseCollection'] | Response>;
}

/** Registers the Home endpoints; the returned object records what the app asked for. */
export function serveHome(server: SetupServer, options: HomeServe = {}): HomeCalls {
  const calls: HomeCalls = { capabilities: 0, lists: [], rows: [], dismissals: [], pages: [] };
  const sections = options.sections ?? [homeSection('recent')];
  server.use(
    http.get(`${BASE_URL}/api/v2/home/capabilities`, () => {
      calls.capabilities += 1;
      return options.capabilities === 'fail'
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(options.capabilities ?? homeCapabilities());
    }),
    http.get(`${BASE_URL}/api/v2/home/sections`, ({ request }) => {
      calls.lists.push(new URL(request.url).searchParams);
      if (sections === 'fail') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({ sections });
    }),
    http.get(`${BASE_URL}/api/v2/home/sections/:id/items`, ({ request, params }) => {
      const id = String(params.id);
      calls.rows.push({ id, query: new URL(request.url).searchParams });
      const custom = options.row?.(id, calls);
      if (custom) return custom;
      const found = sections === 'fail' ? undefined : sections.find((s) => s.id === id);
      return found ? HttpResponse.json(found) : new HttpResponse(null, { status: 404 });
    }),
    http.put(`${BASE_URL}/api/v2/home/dismissals/:surface/:itemId`, async ({ request, params }) => {
      calls.dismissals.push({
        path: `${String(params.surface)}/${String(params.itemId)}`,
        body: await request.json(),
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  // The catalog is only served when the test asks for pages: other tests have their own handler.
  const { page } = options;
  if (page) {
    server.use(
      http.get(`${BASE_URL}/api/v2/catalog`, async ({ request }) => {
        const params = new URL(request.url).searchParams;
        calls.pages.push(params);
        const answer = await page(params, calls);
        return answer instanceof Response ? answer : HttpResponse.json(answer);
      }),
    );
  }
  return calls;
}
