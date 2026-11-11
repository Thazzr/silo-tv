// Typed fixtures and an MSW harness for the Movies and Series tabs (a library's sections, its
// Browse reads, the filter facets, the letter index and the collections), typed against the
// generated schema like the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { catalogItem, library } from './flowFixtures';
import { homeCapabilities, homeSection } from './homeFixtures';

type S = components['schemas'];

export function collectionCard(
  id: string,
  overrides: Partial<S['LibraryCollectionCard']> = {},
): S['LibraryCollectionCard'] {
  return {
    featured: false,
    id,
    item_count: 4,
    poster_is_collage: false,
    poster_url: `/img/${id}-poster.webp`,
    title: `Collection ${id}`,
    ...overrides,
  };
}

/** The collections index of a library: its groups, with the ungrouped cards at their own order. */
export function collectionTab(
  libraryId: string,
  groups: { name: string; order: number; cards: S['LibraryCollectionCard'][] }[],
  ungrouped?: { order: number; cards: S['LibraryCollectionCard'][] },
  descriptions: Record<string, string> = {},
): S['LibraryCollectionTab'] {
  const all = [...groups.flatMap((g) => g.cards), ...(ungrouped?.cards ?? [])];
  return {
    collections: all.map((card) => ({
      backdrop_url: '',
      collection_type: 'manual',
      created_at: '2026-01-01T00:00:00.000Z',
      description: descriptions[card.id] ?? '',
      featured: false,
      group_id: null,
      id: card.id,
      item_count: card.item_count,
      last_sync_message: '',
      last_sync_status: '',
      library_id: libraryId,
      library_ids: [libraryId],
      management_key: '',
      management_mode: '',
      management_source: '',
      poster_is_collage: false,
      poster_url: card.poster_url,
      query_definition: {},
      slug: card.id,
      sort_config: {},
      sort_order: 0,
      source_config: {},
      source_url: '',
      title: card.title,
      updated_at: '2026-01-01T00:00:00.000Z',
      visibility: 'public',
    })),
    groups: groups.map((group, i) => ({
      collections: group.cards,
      id: `group-${i}`,
      kind: 'server',
      name: group.name,
      sort_mode: 'manual',
      sort_order: group.order,
    })),
    library_id: libraryId,
    ungrouped: ungrouped
      ? { collections: ungrouped.cards, sort_order: ungrouped.order }
      : undefined,
  };
}

/** `count` titles called "<prefix> 1", "<prefix> 2", … of the given type. */
export function titles(
  prefix: string,
  count: number,
  type = 'movie',
  offset = 0,
): S['CatalogItem'][] {
  return Array.from({ length: count }, (_, i) =>
    catalogItem({
      content_id: `${prefix}${offset + i + 1}`,
      title: `${prefix} ${offset + i + 1}`,
      type,
      year: 2000 + ((offset + i) % 25),
    }),
  );
}

export function facets(overrides: Partial<S['CatalogFilters']> = {}): S['CatalogFilters'] {
  return {
    authors: [],
    content_ratings: ['PG', 'R'],
    countries: [],
    genres: ['Action', 'Drama', 'Sci-Fi'],
    narrators: [],
    networks: [],
    original_languages: [],
    series: [],
    studios: [],
    technical: { audio_languages: [], resolutions: ['4K', '1080p'], subtitle_languages: [] },
    ...overrides,
  };
}

export interface LibraryCalls {
  /** `library/{id}/sections` reads. */
  sections: { id: string; query: URLSearchParams }[];
  /** The query strings of the Browse (catalog) reads. */
  browse: URLSearchParams[];
  filters: URLSearchParams[];
  /** The watch-rule probes (a one-title read under `watched is false`), apart from the browse reads. */
  probes: URLSearchParams[];
  /** Reads of the search capabilities. */
  capabilities: number;
  /** The JSON bodies of the letter index reads. */
  letters: unknown[];
  collections: string[];
  collectionItems: { id: string; collectionId: string; query: URLSearchParams }[];
}

export interface LibraryServe {
  libraries?: S['UserLibrary'][];
  /** The sections of each library by its id; a library without an entry has one row of movies. */
  sections?: Record<string, S['Section'][]>;
  /** Answers a Browse read; defaults to ten titles. */
  browse?: (
    params: URLSearchParams,
    calls: LibraryCalls,
  ) => S['CatalogBrowseCollection'] | Response | Promise<S['CatalogBrowseCollection'] | Response>;
  filters?: S['CatalogFilters'] | 'fail';
  /** Whether the server accepts the watch-state rules: answers the probe with 200 (default) or 422. */
  watchRules?: boolean | 'fail';
  /** What the search capabilities say about extended rules (decade, title prefix); on by default. */
  extendedRules?: boolean | 'fail';
  /**
   * The letters that have titles (one title each, in that order), a whole letter index, or a
   * failing letter index.
   */
  letters?: string[] | S['CatalogLetters'] | 'fail';
  collections?:
    | Record<string, S['LibraryCollectionTab'] | 'fail'>
    | ((libraryId: string) => S['LibraryCollectionTab'] | 'fail');
  collectionItems?: (
    libraryId: string,
    collectionId: string,
    params: URLSearchParams,
  ) => S['CatalogItemCollection'] | Response;
}

/** Registers the library endpoints; the returned object records what the app asked for. */
export function serveLibrary(server: SetupServer, options: LibraryServe = {}): LibraryCalls {
  const calls: LibraryCalls = {
    sections: [],
    browse: [],
    filters: [],
    probes: [],
    capabilities: 0,
    letters: [],
    collections: [],
    collectionItems: [],
  };
  const libraries = options.libraries ?? [library({ id: 'lib-1', name: 'Movies', type: 'movies' })];
  server.use(
    http.get(`${BASE_URL}/api/v2/user/libraries`, () => HttpResponse.json({ items: libraries })),
    http.get(`${BASE_URL}/api/v2/home/capabilities`, () => HttpResponse.json(homeCapabilities())),
    http.get(`${BASE_URL}/api/v2/library/:id/sections`, ({ request, params }) => {
      const id = String(params.id);
      calls.sections.push({ id, query: new URL(request.url).searchParams });
      return HttpResponse.json({ sections: options.sections?.[id] ?? [homeSection(`${id}-rec`)] });
    }),
    http.get(`${BASE_URL}/api/v2/catalog`, async ({ request }) => {
      const query = new URL(request.url).searchParams;
      if (query.get('limit') === '1' && (query.get('groups') ?? '').includes('"watched"')) {
        calls.probes.push(query);
        if (options.watchRules === false) {
          return HttpResponse.json(
            { type: 'about:blank', title: 'Unprocessable', status: 422 },
            { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        if (options.watchRules === 'fail') return new HttpResponse(null, { status: 500 });
        return HttpResponse.json({ items: [], total: 0, total_exact: true, window_cursor: 'p' });
      }
      calls.browse.push(query);
      const answer = options.browse
        ? await options.browse(query, calls)
        : {
            items: titles('Title', 10),
            total: 10,
            total_exact: true,
            window_cursor: 'cursor',
          };
      return answer instanceof Response ? answer : HttpResponse.json(answer);
    }),
    http.get(`${BASE_URL}/api/v2/catalog/search/capabilities`, () => {
      calls.capabilities += 1;
      if (options.extendedRules === 'fail') return new HttpResponse(null, { status: 500 });
      return HttpResponse.json({
        allowed: true,
        revision: 'r1',
        state: 'available',
        extended_query_rules: options.extendedRules ?? true,
      });
    }),
    http.get(`${BASE_URL}/api/v2/catalog/filters`, ({ request }) => {
      calls.filters.push(new URL(request.url).searchParams);
      return options.filters === 'fail'
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(options.filters ?? facets());
    }),
    http.post(`${BASE_URL}/api/v2/catalog/letters`, async ({ request }) => {
      calls.letters.push(await request.json());
      if (options.letters === 'fail') return new HttpResponse(null, { status: 501 });
      const letters = options.letters ?? ['#', 'A', 'B', 'C'];
      if (!Array.isArray(letters)) return HttpResponse.json(letters);
      return HttpResponse.json({
        letters: letters.map((letter, i) => ({ letter, count: 1, position: i })),
        runs: letters.map((letter, i) => ({ letter, position: i })),
        total: letters.length,
      });
    }),
    http.get(`${BASE_URL}/api/v2/library/:id/collections`, ({ params }) => {
      const id = String(params.id);
      calls.collections.push(id);
      const given =
        typeof options.collections === 'function'
          ? options.collections(id)
          : options.collections?.[id];
      const tab = given ?? collectionTab(id, []);
      return tab === 'fail' ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(tab);
    }),
    http.get(
      `${BASE_URL}/api/v2/library/:id/collections/:collectionId/items`,
      ({ request, params }) => {
        const id = String(params.id);
        const collectionId = String(params.collectionId);
        const query = new URL(request.url).searchParams;
        calls.collectionItems.push({ id, collectionId, query });
        const answer = options.collectionItems?.(id, collectionId, query) ?? {
          items: titles(`${collectionId}-`, 3),
        };
        return answer instanceof Response ? answer : HttpResponse.json(answer);
      },
    ),
  );
  return calls;
}
