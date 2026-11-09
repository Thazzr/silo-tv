// Typed fixtures and an MSW harness for the detail pages, typed against the generated schema like
// the other fixtures.
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import type { components } from '../api/generated/schema';
import { BASE_URL } from './apiFixtures';
import { serveSettings, type SettingsServe } from './settingsFixtures';
import {
  serveTranslation,
  type TranslationCalls,
  type TranslationServe,
} from './translationFixtures';

type S = components['schemas'];

export function fileVersion(overrides: Partial<S['FileVersion']> = {}): S['FileVersion'] {
  return {
    added_at: '2026-01-01T00:00:00.000Z',
    bitrate: 8000,
    codec_audio: 'aac',
    codec_video: 'h264',
    container: 'mkv',
    duration: 5400,
    file_id: 'file-1',
    file_size: 1000,
    hdr: false,
    resolution: '1080p',
    ...overrides,
  };
}

export function itemDetail(
  overrides: Partial<S['CatalogItemDetail']> = {},
): S['CatalogItemDetail'] {
  return {
    cast: [],
    content_id: 'm1',
    crew: [],
    genres: ['Drama', 'Mystery', 'Thriller', 'Comedy'],
    keywords: [],
    ratings: [],
    status: 'matched',
    subtitles: [],
    title: 'First Title',
    type: 'movie',
    versions: [fileVersion()],
    year: 2019,
    runtime: 92,
    content_rating: 'PG-13',
    overview: 'A short synopsis.',
    ...overrides,
  };
}

export function rollup(overrides: Partial<S['WatchRollup']> = {}): S['WatchRollup'] {
  return {
    in_progress_count: 0,
    played: false,
    unplayed_count: 1,
    watched_count: 0,
    ...overrides,
  };
}

export function seasonOf(number: number, overrides: Partial<S['Season']> = {}): S['Season'] {
  return {
    content_id: `season-${number}`,
    episode_count: 3,
    season_number: number,
    title: number === 0 ? 'Specials' : `Season ${number}`,
    ...(number === 0 ? { is_specials: true } : {}),
    ...overrides,
  };
}

export function episodeOf(
  season: number,
  number: number,
  overrides: Partial<S['Episode']> = {},
): S['Episode'] {
  return {
    content_id: `e${season}${number}`,
    episode_number: number,
    runtime: 45,
    season_number: season,
    title: `Episode ${season}.${number}`,
    overview: `Synopsis of ${season}.${number}.`,
    ...overrides,
  };
}

export interface DetailCalls {
  /** Ids of the item reads. */
  items: string[];
  /** Series ids of the season list reads. */
  seasons: string[];
  /** `series/season` of the episode list reads. */
  episodes: string[];
  /** Ids of the "More like this" reads, with their query strings. */
  similar: { id: string; query: URLSearchParams }[];
  /** Reads of the search capabilities. */
  capabilities: number;
  /** The reads of a movie's box set: id and query string of each. */
  boxSets: { id: string; query: URLSearchParams }[];
  /** The metadata-AI capability reads and the translate requests. */
  translation: TranslationCalls;
}

export interface DetailServe {
  /** Answers an item read; `gone` is a 404 and `fail` a 500. Defaults to a plain movie. */
  item?: (id: string, calls: DetailCalls) => S['CatalogItemDetail'] | 'gone' | 'fail';
  seasons?: S['Season'][] | 'fail';
  /** Answers an episode list read for a season number. */
  episodes?: (
    season: number,
    calls: DetailCalls,
  ) => S['Episode'][] | 'fail' | Promise<S['Episode'][] | 'fail'>;
  similar?: S['CatalogItem'][] | 'fail';
  /** What the server's search capabilities say; no box sets unless `box_sets` is set. */
  capabilities?: Partial<S['CatalogSearchCapabilities']> | 'fail';
  /** The box set a movie page shows; `none` is the plain 200 without one, `fail` a 500. */
  boxSet?: S['CatalogBoxSetDetail'] | 'none' | 'fail';
  /** What the profile's settings say; the contract defaults (title art on) when omitted. */
  settings?: SettingsServe;
  /** What the server's metadata-AI capability says; translation is off when omitted. */
  translation?: TranslationServe;
}

/** Registers the detail endpoints; the returned object records what the app asked for. */
export function serveDetail(server: SetupServer, options: DetailServe = {}): DetailCalls {
  const calls: DetailCalls = {
    items: [],
    seasons: [],
    episodes: [],
    similar: [],
    capabilities: 0,
    boxSets: [],
    translation: { posts: [], capabilities: 0 },
  };
  const fail = () => new HttpResponse(null, { status: 500 });
  serveSettings(server, options.settings);
  calls.translation = serveTranslation(server, options.translation);
  server.use(
    http.get(`${BASE_URL}/api/v2/catalog/items/:id`, ({ params }) => {
      const id = String(params.id);
      calls.items.push(id);
      const answer = options.item ? options.item(id, calls) : itemDetail({ content_id: id });
      if (answer === 'gone') return new HttpResponse(null, { status: 404 });
      return answer === 'fail' ? fail() : HttpResponse.json(answer);
    }),
    http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons`, ({ params }) => {
      calls.seasons.push(String(params.id));
      const answer = options.seasons ?? [];
      return answer === 'fail' ? fail() : HttpResponse.json({ items: answer });
    }),
    http.get(`${BASE_URL}/api/v2/catalog/series/:id/seasons/:num/episodes`, async ({ params }) => {
      const num = Number(params.num);
      calls.episodes.push(`${String(params.id)}/${num}`);
      const answer = options.episodes ? await options.episodes(num, calls) : [];
      return answer === 'fail' ? fail() : HttpResponse.json({ items: answer });
    }),
    http.get(`${BASE_URL}/api/v2/recommendations/similar/:id`, ({ params, request }) => {
      calls.similar.push({ id: String(params.id), query: new URL(request.url).searchParams });
      const answer = options.similar ?? [];
      return answer === 'fail' ? fail() : HttpResponse.json({ items: answer });
    }),
    http.get(`${BASE_URL}/api/v2/catalog/search/capabilities`, () => {
      calls.capabilities += 1;
      if (options.capabilities === 'fail') return fail();
      return HttpResponse.json({
        allowed: true,
        revision: 'r1',
        state: 'available',
        ...options.capabilities,
      });
    }),
    http.get(`${BASE_URL}/api/v2/catalog/items/:id/box-set`, ({ params, request }) => {
      calls.boxSets.push({ id: String(params.id), query: new URL(request.url).searchParams });
      const answer = options.boxSet ?? 'none';
      if (answer === 'fail') return fail();
      return HttpResponse.json(answer === 'none' ? {} : { box_set: answer });
    }),
  );
  return calls;
}
