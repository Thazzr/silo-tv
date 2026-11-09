// Typed fixtures and an MSW harness for the person page, typed against the generated schema like
// the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { catalogItem } from './flowFixtures';

type S = components['schemas'];

export function personOf(overrides: Partial<S['Person']> = {}): S['Person'] {
  return {
    id: 'p-1',
    name: 'Ada Actor',
    bio: 'A short biography.',
    birth_date: '1940-04-25',
    birthplace: 'Springfield, USA',
    ...overrides,
  };
}

/** `n` movie cards "Movie 1".."Movie n" with falling years (newest first, as the server sorts). */
export function movies(n: number, from = 1): S['CatalogItem'][] {
  return Array.from({ length: n }, (_, i) =>
    catalogItem({
      content_id: `mov-${from + i}`,
      title: `Movie ${from + i}`,
      type: 'movie',
      year: 2030 - (from + i),
    }),
  );
}

export function shows(n: number): S['CatalogItem'][] {
  return Array.from({ length: n }, (_, i) =>
    catalogItem({
      content_id: `ser-${i + 1}`,
      title: `Show ${i + 1}`,
      type: 'series',
      year: 2010 - i,
    }),
  );
}

export type PersonTitleType = 'video' | 'movie' | 'series';

export interface PersonCalls {
  /** Ids of the person reads, with their query strings. */
  people: { id: string; query: URLSearchParams }[];
  /** The query of every filmography or probe read. */
  titles: URLSearchParams[];
  /** Every request the harness saw: "GET /path". Used to prove that nothing else is called. */
  requests: string[];
}

export interface PersonServe {
  /** The person; `gone` is a 404 and `fail` a 500. Defaults to `personOf()`. */
  person?: S['Person'] | 'gone' | 'fail';
  /** The titles per `type` parameter; a missing key is an empty list, `fail` a 500. */
  titles?: Partial<Record<PersonTitleType, S['CatalogItem'][] | 'fail'>>;
  /** What the server says about its totals; exact unless given. */
  totalExact?: boolean;
  /** Answers the person read only after this promise (a slow server). */
  holdPerson?: Promise<void>;
}

/** Registers the person endpoints; the returned object records what the app asked for. */
export function servePerson(server: SetupServer, options: PersonServe = {}): PersonCalls {
  const calls: PersonCalls = { people: [], titles: [], requests: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/people/:id`, async ({ params, request }) => {
      if (options.holdPerson) await options.holdPerson;
      calls.requests.push(`GET ${new URL(request.url).pathname}`);
      calls.people.push({ id: String(params.id), query: new URL(request.url).searchParams });
      const answer = options.person ?? personOf({ id: String(params.id) });
      if (answer === 'gone') return new HttpResponse(null, { status: 404 });
      return answer === 'fail'
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(answer);
    }),
    http.get(`${BASE_URL}/api/v2/catalog`, async ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.requests.push(`GET ${new URL(request.url).pathname}`);
      calls.titles.push(query);
      const type = (query.get('type') ?? 'video') as PersonTitleType;
      const list = options.titles?.[type] ?? [];
      if (list === 'fail') return new HttpResponse(null, { status: 500 });
      const limit = Number(query.get('limit') ?? 50);
      const start = Number(query.get('cursor') ?? 0);
      const items = list.slice(start, start + limit);
      const more = start + limit < list.length;
      return HttpResponse.json({
        items,
        total: list.length,
        total_exact: options.totalExact ?? true,
        window_cursor: 'w',
        page: more ? { has_more: true, next_cursor: String(start + limit) } : { has_more: false },
      } satisfies S['CatalogBrowseCollection']);
    }),
  );
  return calls;
}
