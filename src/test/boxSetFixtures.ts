// Typed fixtures and an MSW harness for the box set page, typed against the generated schema like
// the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { catalogItem } from './flowFixtures';

type S = components['schemas'];

/** A film card whose watch state is set: `played` marks it as played. */
export function boxSetFilm(n: number, played = false): S['CatalogItem'] {
  return catalogItem({
    content_id: `film-${n}`,
    title: `Film ${n}`,
    type: 'movie',
    year: 2000 + n,
    user_state: { in_watchlist: false, is_favorite: false, not_interested: false, played },
  });
}

/** `count` films "Film 1".."Film count" in collection order, the first `played` of them played. */
export function boxSetFilms(count: number, played = 0): S['CatalogItem'][] {
  return Array.from({ length: count }, (_, i) => boxSetFilm(i + 1, i < played));
}

/** A box set of `films` films of which `played` are played (the counts follow the films). */
export function boxSetDetail(
  overrides: Partial<S['CatalogBoxSetDetail']> = {},
  films = 3,
  played = 0,
): S['CatalogBoxSetDetail'] {
  return {
    id: 'bs-1',
    library_id: 'lib-1',
    title: 'Great Saga Box Set',
    overview: 'Three films about a great saga.',
    first_year: 2001,
    last_year: 2003,
    movie_count: films,
    played_count: played,
    items: boxSetFilms(films, played),
    ...overrides,
  };
}

/** The summary of a box set, as search and lists show it. */
export function boxSetSummary(overrides: Partial<S['CatalogBoxSet']> = {}): S['CatalogBoxSet'] {
  return {
    id: 'bs-1',
    library_id: 'lib-1',
    title: 'Great Saga Box Set',
    first_year: 2001,
    last_year: 2003,
    movie_count: 3,
    played_count: 0,
    ...overrides,
  };
}

export interface BoxSetCalls {
  /** The reads of the box set page: id and query string of each. */
  reads: { id: string; query: URLSearchParams }[];
}

export interface BoxSetServe {
  /** What the read answers; `gone` is a 404 and `fail` a 500. Defaults to `boxSetDetail()`. */
  boxSet?:
    | S['CatalogBoxSetDetail']
    | 'gone'
    | 'fail'
    | ((calls: BoxSetCalls) => S['CatalogBoxSetDetail'] | 'gone' | 'fail');
  /** Answers the read only after this promise (a slow server). */
  hold?: Promise<void>;
}

/** Registers the box set endpoint; the returned object records what the app asked for. */
export function serveBoxSet(server: SetupServer, options: BoxSetServe = {}): BoxSetCalls {
  const calls: BoxSetCalls = { reads: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/box-sets/:id`, async ({ params, request }) => {
      if (options.hold) await options.hold;
      calls.reads.push({ id: String(params.id), query: new URL(request.url).searchParams });
      const given = options.boxSet ?? boxSetDetail({ id: String(params.id) });
      const answer = typeof given === 'function' ? given(calls) : given;
      if (answer === 'gone') return new HttpResponse(null, { status: 404 });
      return answer === 'fail'
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json(answer);
    }),
  );
  return calls;
}
