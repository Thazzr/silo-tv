import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { distIndexUrl } from './paths.ts';

// A fake Silo server on 127.0.0.1 with permissive CORS (like probe.spec.ts, a real server instead
// of page.route(): Playwright does not apply the response-side CORS check to routed requests).
// It speaks just enough of /api/v2 for the first flow: server check, device-code sign-in that is
// approved on the second poll (or, per option, password sign-in only), one profile without a PIN,
// the Home sections (Continue Watching, and Recently Added with more titles than its row shows),
// one library with two titles, the detail pages of a movie (half way through) and a series with
// two seasons, the person page of a cast member, and the playback protocol up to a plan whose media never answers (the loading cue
// stays). Every instance has its own origin (its own port), which is what the
// app keys servers and sessions by.

interface Seen {
  method: string;
  path: string;
  search: string;
  authorization: string | undefined;
  profileId: string | undefined;
  /** The request body, for the sign-in call only. */
  body: string;
}

interface FakeOptions {
  /** Shown as the server's name. */
  name?: string;
  /** The access token this server hands out. */
  token?: string;
  /** Whether the server offers sign-in with a code. */
  code?: boolean;
  /** Whether the server offers password sign-in. */
  password?: boolean;
  /** The household's profiles; one primary profile without a PIN when omitted. */
  profiles?: FakeProfile[];
  /** Puts a series ("A Show") first in the Recently Added row. */
  series?: boolean;
  /** Adds a series library with a collection to the library list (the Series tab then has content). */
  seriesLibrary?: boolean;
  /** The home capabilities request never gets an answer (the real server sometimes takes minutes). */
  homeCapabilitiesNeverAnswer?: boolean;
  /** Adds a watched episode that is being watched again (position 600 s of 2700 s) to Continue Watching. */
  rewatch?: boolean;
  /**
   * Tall detail pages: the series gets a logo, a long synopsis, ratings and a credit line (a hero
   * taller than 760 px), the movie gets a cast and a "More like this" row.
   */
  tall?: boolean;
  /**
   * The movie "Second Title" is a long hero like a real film's page: a logo (with `titleArt`), a
   * two-line tagline, a synopsis of about nine lines, a two-line credit line and the ratings.
   */
  longMovie?: boolean;
  /** "Weiterschauen" holds twelve more titles ("Extra 1" to "Extra 12"): the row reaches past the screen's right edge. */
  longRow?: boolean;
  /**
   * The server has box sets: "Second Title" (m2) is the middle film of the box set "Saga Box Set",
   * whose first film is played; its page and the movie's row read from the same data.
   */
  boxSet?: boolean;
  /**
   * "Second Title" (m2) and the series (s1) have two local extras (a trailer with a title, a
   * featurette without one) and one YouTube video; the first extra's file answers the playback
   * calls like any title.
   */
  extras?: boolean;
  /** The season pages carry a cast of two and a crew (director, writer, producer, screenplay). */
  seasonCredits?: boolean;
  /** How many episodes each season lists (2 when omitted). */
  episodeCount?: number;
  /** A biography of about 4,000 characters on the person pages (the last line says THE END). */
  longBio?: boolean;
  /** How many seasons the series has (2 when omitted). */
  seasons?: number;
  /**
   * The series' seasons carry posters, the first one is watched and the second one is in progress
   * (one of its two episodes watched), and every episode has a still.
   */
  posters?: boolean;
  /** Extra genres ("Genre 01", ...) after Action and Drama: a facet list longer than its panel. */
  genres?: number;
  /** An older server: the watch-state rules answer 422 (the Status section then stays out). */
  noWatchRules?: boolean;
  /**
   * The server speaks the settings contract and the profile's `ui.title_art` is this value; an
   * older server (the default) does not know the contract and answers 404.
   */
  titleArt?: boolean;
  /**
   * The server speaks the settings contract and both spoiler settings are this value. The series'
   * first episode is unwatched and the second one is played; every episode has a still.
   */
  spoilers?: boolean;
  /**
   * The server speaks the settings contract and the profile's `ui.theme_music_enabled` is this
   * value; the theme capability is available and "Second Title" (m2) has a theme song.
   */
  themeMusic?: boolean;
  /**
   * The server speaks the settings contract and nothing else is stored, so the subtitle
   * appearance is the default (large, white, box). Writes to `playback.subtitle_appearance` are
   * recorded with their body.
   */
  subtitles?: boolean;
  /**
   * The server offers viewer-triggered AI translation in this mode. "Second Title" (m2) then
   * reports its description as pending in German until the translate request came in; afterwards
   * it carries the translated text, marked as machine-translated.
   */
  translation?: 'auto' | 'button';
  /**
   * The server speaks the settings contract with the profile's `playback.buffering_quality_mode`
   * set to this value, and the playing plan delivers 10 Mbit/s with a 5 Mbit/s replan behind it.
   * Replans are recorded with their body.
   */
  buffering?: 'never' | 'ask' | 'always';
  /**
   * "Second Title" (m2) and the episodes have two files each (1080p and 2160p HDR, the sharper
   * one 5 minutes longer) with two audio tracks and three subtitle tracks, so their pages show the
   * version, audio and subtitle pills. The title's track preferences are accepted (recorded with
   * their body), and every file has one downloaded subtitle.
   */
  pills?: boolean;
  /**
   * The server speaks the settings contract (nothing stored for the card overlays, the server-wide
   * defaults apply) and its titles carry what the badges show: "First Title" (m1) is a watched
   * 1080p Dolby Vision BluRay with EAC3 audio, "A Show" (s1) is a started series with three
   * episodes left, and every movie of the Browse view has a resolution.
   */
  badges?: boolean;
  /**
   * Home and the Movies library have a featured section ("Trending", three slides: the first three
   * titles), which is the hero carousel; it is read on its own, like the web does.
   */
  featured?: boolean;
}

interface FakeProfile {
  id: string;
  name: string;
  has_pin: boolean;
  is_primary: boolean;
  is_child: boolean;
}

const servers: Server[] = [];

/** A small portrait ThumbHash for the stills of the spoiler flow. */
const STILL_THUMBHASH = 'KAhS8zzDGU8oXWtw6pMcVZjSZHc7jOEppvRQfTg=';

// The titles of the Movies library, for the Browse view: the fake server sorts, filters by genre,
// and lists the letters the way Silo does.
interface FakeTitle {
  id: string;
  title: string;
  year: number;
  genre: string;
  rating: string;
  watched: boolean;
}
const MOVIES: FakeTitle[] = [
  { id: 'm1', title: 'First Title', year: 2019, genre: 'Drama', rating: 'FSK 12', watched: true },
  {
    id: 'm2',
    title: 'Second Title',
    year: 2021,
    genre: 'Action',
    rating: 'FSK 16',
    watched: false,
  },
  { id: 'm3', title: 'Third Title', year: 2020, genre: 'Drama', rating: 'FSK 12', watched: true },
  {
    id: 'm4',
    title: 'Fourth Title',
    year: 2018,
    genre: 'Action',
    rating: 'FSK 18',
    watched: false,
  },
  {
    id: 'm5',
    title: 'Seventh Title',
    year: 2017,
    genre: 'Action',
    rating: 'FSK 16',
    watched: false,
  },
  { id: 'm6', title: 'Alpha Title', year: 2015, genre: 'Drama', rating: 'FSK 12', watched: true },
];

interface FakeRule {
  field: string;
  op: string;
  value: unknown;
}
type FakeGroup = { match: string; rules: FakeRule[] };

/** The titles that satisfy the genre and watched rules of the groups (the rules these flows send). */
function filterTitles(groups: FakeGroup[]): FakeTitle[] {
  const matches = (rule: FakeRule, movie: FakeTitle) =>
    (rule.field === 'genre' && rule.value === movie.genre) ||
    (rule.field === 'watched' && rule.value === movie.watched);
  return MOVIES.filter((movie) =>
    groups.every((group) => group.rules.some((rule) => matches(rule, movie))),
  );
}

function browseTitles(params: URLSearchParams): FakeTitle[] {
  const groups = JSON.parse(params.get('groups') ?? '[]') as FakeGroup[];
  const sort = params.get('sort') ?? 'title';
  const field = sort.replace(/^-/, '') === 'year' ? 'year' : 'title';
  const direction = sort.startsWith('-') ? -1 : 1;
  const ratings = params.getAll('content_rating');
  return filterTitles(groups)
    .filter((movie) => ratings.length === 0 || ratings.includes(movie.rating))
    .sort((a, b) =>
      field === 'year' ? (a.year - b.year) * direction : a.title.localeCompare(b.title) * direction,
    );
}

/** The featured section of Home or of the Movies library: the first three titles as slides. */
const featuredSection = (id: string) => ({
  id,
  section_type: 'trending',
  title: 'Trending',
  featured: true,
  item_limit: 3,
  is_custom: false,
  customized: false,
  total_count: 3,
  items: MOVIES.slice(0, 3).map((movie) => ({
    ...asCard(movie),
    genres: [movie.genre],
    overview: `${movie.title} is on the carousel.`,
    backdrop_url: '/img/bd-bright.svg',
  })),
});

const asCard = (movie: FakeTitle, badges = false) => ({
  content_id: movie.id,
  title: movie.title,
  type: 'movie',
  year: movie.year,
  ...(badges ? { overlay_summary: { resolution: '2160p' } } : {}),
});

async function startFakeSilo(options: FakeOptions = {}): Promise<{ origin: string; seen: Seen[] }> {
  const { name = 'E2E Silo', token = 'fake-access', code = true, password = false } = options;
  const withSeries = options.series === true;
  const withSeriesLibrary = options.seriesLibrary === true;
  const withRewatch = options.rewatch === true;
  const tall = options.tall === true;
  const withLongRow = options.longRow === true;
  const withExtras = options.extras === true;
  const seasonCount = options.seasons ?? 2;
  const withBoxSet = options.boxSet === true;
  // Two files of a title with their tracks: the 2160p one is the sharper and 5 minutes longer.
  const trackedFiles = (id: string) =>
    [
      { name: 'hd', resolution: '1080p', video: 'h264', audio: 'aac', hdr: false, seconds: 5400 },
      {
        name: 'uhd',
        resolution: '2160p',
        video: 'hevc',
        audio: 'truehd',
        hdr: true,
        seconds: 5700,
      },
    ].map((file) => ({
      file_id: `${id}-${file.name}`,
      added_at: '2026-01-01T00:00:00.000Z',
      resolution: file.resolution,
      codec_video: file.video,
      codec_audio: file.audio,
      container: 'mkv',
      hdr: file.hdr,
      duration: file.seconds,
      file_size: 4_500_000_000,
      bitrate: 12_300,
      audio_tracks: [
        { default: true, language: 'de', codec: 'eac3', channels: 6 },
        { default: false, language: 'en', codec: 'aac', channels: 2 },
      ],
      subtitle_tracks: [
        {
          default: false,
          external: false,
          forced: false,
          hearing_impaired: false,
          language: 'en',
          codec: 'subrip',
          index: 0,
        },
        {
          default: false,
          external: false,
          forced: true,
          hearing_impaired: false,
          language: 'de',
          codec: 'subrip',
          index: 1,
        },
        {
          default: false,
          external: true,
          forced: false,
          hearing_impaired: false,
          language: 'fr',
          codec: 'ass',
          file_name: 'film.fr.ass',
          index: 2,
        },
      ],
    }));
  const settingsUnknown =
    options.titleArt === undefined &&
    options.spoilers === undefined &&
    options.themeMusic === undefined &&
    options.subtitles === undefined &&
    options.buffering === undefined &&
    options.badges === undefined;
  const sagaFilms = [
    { content_id: 'f1', title: 'Saga One', type: 'movie', year: 2001, played: true },
    { content_id: 'm2', title: 'Second Title', type: 'movie', year: 2021, played: false },
    { content_id: 'f3', title: 'Saga Three', type: 'movie', year: 2023, played: false },
  ].map(({ played, ...film }) => ({
    ...film,
    user_state: { in_watchlist: false, is_favorite: false, not_interested: false, played },
  }));
  const saga = {
    id: 'bs1',
    library_id: 'lib-1',
    title: 'Saga Box Set',
    overview: 'Three films of one saga.',
    first_year: 2001,
    last_year: 2023,
    movie_count: 3,
    played_count: 1,
    items: sagaFilms,
  };
  const longBio =
    Array.from({ length: 80 }, (_, i) => `Sentence ${i + 1} of the long biography.`).join(' ') +
    ' THE END';
  const genreNames = [
    'Action',
    'Drama',
    ...Array.from(
      { length: options.genres ?? 0 },
      (_, i) => `Genre ${String(i + 1).padStart(2, '0')}`,
    ),
  ];
  const profiles: FakeProfile[] = [
    ...(options.profiles ?? [
      { id: 'profile-1', name: 'Alex', has_pin: false, is_primary: true, is_child: false },
    ]),
  ];
  const seen: Seen[] = [];
  let polls = 0;
  let translated = false;
  const server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => handle(Buffer.concat(chunks).toString('utf8')));
    const handle = (requestBody: string) => {
      seen.push({
        method: req.method ?? '',
        path: url.pathname,
        search: url.search,
        authorization: req.headers.authorization,
        profileId: req.headers['x-profile-id'] as string | undefined,
        body:
          url.pathname === '/api/v2/auth/login' ||
          url.pathname === '/api/v2/profiles' ||
          url.pathname === '/api/v2/playback/start' ||
          url.pathname === '/api/v2/playback/e2e-session/replan' ||
          (url.pathname.endsWith('/playback') && url.pathname.includes('/themes/')) ||
          url.pathname.endsWith('/translate-description') ||
          url.pathname.startsWith('/api/v2/audio-prefs/') ||
          url.pathname === '/api/v2/settings/values/playback.subtitle_appearance'
            ? requestBody
            : '',
      });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const tokens = {
        access_token: token,
        refresh_token: `${token}-refresh`,
        expires_in: 3600,
        user: { id: 'user-1', username: 'viewer', role: 'user' },
      };
      // The detail pages: a movie that is half way through, and a series with two seasons.
      const baseItem = {
        genres: [],
        keywords: [],
        status: 'matched',
        cast: [],
        crew: [],
        versions: [],
        ratings: [],
        subtitles: [],
      };
      if (req.method === 'GET' && /^\/img\/(logo|still-\w+|poster-\w+)\.png$/.test(url.pathname)) {
        // A 1x1 transparent PNG; the logo box gives it its size.
        res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
        return res.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
      }
      if (req.method === 'GET' && url.pathname === '/img/bd-bright.svg') {
        // A plain light grey picture of a known brightness (200 of 255).
        res.writeHead(200, { ...cors, 'Content-Type': 'image/svg+xml' });
        return res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="rgb(200,200,200)"/></svg>',
        );
      }
      const tallMovie = tall
        ? {
            poster_url: '/img/poster-m2.png',
            tagline: 'Half way through is still on the way.',
            studios: ['Studio Ponoc', 'Second Studio'],
            genres: ['Drama', 'Crime'],
            content_rating: 'PG',
            overview:
              'The second title, half way through. It tells of a long evening, a house full of guests and one quiet person who notices what nobody else does: the clock that is five minutes slow, the open window, the second cup that nobody ordered. By the time the guests leave, everything in the house has changed, and so has the person who saw it all happen from the hallway. Years later the same guests meet again in the same house, and the clock is still five minutes slow, which is exactly why nobody ever misses the last train home that night.' +
              // At the hero's 1300 px width the text still runs past six lines.
              ' The house is quiet again, and the guests have long gone home.'.repeat(8),
            ratings: [
              { source: 'imdb', name: 'IMDb', display: '8.1' },
              { source: 'tmdb', name: 'TMDB', display: '7.9' },
              { source: 'rt', name: 'RT', display: '93%' },
              { source: 'mc', name: 'Metacritic', display: '71' },
            ],
            crew: [
              { person_id: 'c1', name: 'Dana Director', job: 'Director' },
              { person_id: 'c2', name: 'Wen Writer', job: 'Writer' },
            ],
            versions: [
              {
                file_id: 'f-uhd',
                added_at: '2026-01-01T00:00:00.000Z',
                bitrate: 20000,
                codec_audio: 'dts',
                codec_video: 'hevc',
                container: 'mkv',
                duration: 6180,
                file_size: 1000,
                hdr: true,
                resolution: '2160p',
                video_tracks: [
                  {
                    video_range_type: 'HDR10',
                    dv_config_present: false,
                    dv_bl_compat_id_present: false,
                    interlaced: false,
                  },
                ],
              },
            ],
            cast: ['Ann Actor', 'Bo Actor', 'Cy Actor', 'Di Actor'].map((name, order) => ({
              person_id: `p${order}`,
              name,
              character: `Role ${order}`,
              order,
            })),
          }
        : {};
      const extrasOf = {
        extras: [
          {
            content_id: 'local-x1',
            kind: 'trailer',
            title: 'Official Trailer',
            duration_seconds: 125,
          },
          { content_id: 'local-x2', kind: 'featurette', duration_seconds: 600 },
        ],
        videos: [
          {
            site: 'youtube',
            site_key: 'dQw4w9WgXcQ',
            kind: 'teaser',
            is_official: true,
            name: 'The Teaser',
          },
        ],
      };
      const longMovie = options.longMovie
        ? {
            logo_url: '/img/logo.png',
            poster_url: '/img/poster-m2.png',
            tagline:
              'Two patrol officers answer one more call, and the night turns out to be longer than the shift they signed up for.',
            studios: ['Studio Ponoc'],
            genres: ['Drama', 'Crime', 'Thriller'],
            overview: `${'A long evening in a quiet town, a patrol car with two tired officers and one call that does not end where the radio said it would. '.repeat(12)}Nobody who was there remembers the night the same way, and the last line of this text says THE END.`,
            ratings: [
              { source: 'imdb', name: 'IMDb', display: '6.1' },
              { source: 'tmdb', name: 'TMDB', display: '6.4' },
            ],
            // One file: the Audio and Subtitles pills fit one line; `pills` adds the Version pill.
            versions: trackedFiles('m2').slice(0, 1),
            crew: [
              { person_id: 'c1', name: 'Dana Director', job: 'Director' },
              { person_id: 'c2', name: 'Wen Writer', job: 'Writer' },
              { person_id: 'c3', name: 'Ines Writer', job: 'Writer' },
              { person_id: 'c4', name: 'Tom Writer', job: 'Writer' },
            ],
          }
        : {};
      const tallSeries = tall
        ? {
            logo_url: '/img/logo.png',
            poster_url: '/img/poster-s1.png',
            networks: ['AMC', 'Netflix'],
            first_air_date: '2008-01-20',
            last_air_date: '2013-09-29',
            content_rating: '18',
            tagline: 'A show about a school.',
            genres: ['Drama', 'Crime', 'Thriller'],
            crew: [{ person_id: 'c3', name: 'Vince Creator', job: 'Creator' }],
            overview:
              'A long synopsis that runs over four lines on the hero of the detail page: it tells of a school, its playground, a great many children and the one teacher who has to keep them all busy until the bell rings and the next lesson begins, which is exactly why it needs the full text under the button.'.repeat(
                3,
              ),
            ratings: [
              { source: 'imdb', name: 'IMDb', display: '7.4' },
              { source: 'tmdb', name: 'TMDb', display: '7.9' },
            ],
            cast: ['Ann Actor', 'Bo Actor', 'Cy Actor'].map((name, order) => ({
              person_id: `p${order}`,
              name,
              character: '',
              order,
            })),
          }
        : {};
      // "Saga Three", a search result that opens a plain movie page.
      if (req.method === 'GET' && url.pathname === '/api/v2/catalog/items/f3') {
        return send(200, {
          ...baseItem,
          content_id: 'f3',
          type: 'movie',
          title: 'Saga Three',
          year: 2023,
          runtime: 100,
          overview: 'The third film.',
        });
      }
      const detail = /^\/api\/v2\/catalog\/items\/(m2|s1)$/.exec(url.pathname);
      if (req.method === 'GET' && detail) {
        return send(
          200,
          detail[1] === 'm2'
            ? {
                ...baseItem,
                content_id: 'm2',
                type: 'movie',
                title: 'Second Title',
                year: 2021,
                runtime: 90,
                overview: 'The second title, half way through.',
                themes: {
                  owner_id: '42',
                  items: [{ id: '5', title: 'Main Theme', duration_seconds: 80, container: 'mp3' }],
                },
                user_data: {
                  position_seconds: 1350,
                  duration_seconds: 5400,
                  played: false,
                  watched_count: 0,
                  unplayed_count: 1,
                  in_progress_count: 1,
                },
                ...tallMovie,
                ...longMovie,
                ...(options.pills ? { versions: trackedFiles('m2') } : {}),
                ...(options.translation
                  ? translated
                    ? { overview: 'Der übersetzte Text.', machine_translated_fields: ['overview'] }
                    : { pending_translation_language: 'de' }
                  : {}),
                ...(withExtras ? extrasOf : {}),
              }
            : {
                ...baseItem,
                content_id: 's1',
                type: 'series',
                title: 'A Show',
                year: 2020,
                season_count: seasonCount,
                overview: 'A show with two seasons.',
                play_content_id: 'e11',
                play_season_number: 1,
                ...tallSeries,
                ...(withExtras ? extrasOf : {}),
              },
        );
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/catalog/series/s1/seasons') {
        return send(200, {
          items: Array.from({ length: seasonCount }, (_, i) => i + 1).map((n) => ({
            content_id: `season-${n}`,
            season_number: n,
            title: `Season ${n}`,
            episode_count: 2,
            play_content_id: `e${n}1`,
            ...(options.posters
              ? {
                  poster_url: `/img/poster-season${n}.png`,
                  user_data:
                    n === 1
                      ? { played: true, in_progress_count: 0, unplayed_count: 0, watched_count: 2 }
                      : n === 2
                        ? {
                            played: false,
                            in_progress_count: 0,
                            unplayed_count: 1,
                            watched_count: 1,
                          }
                        : undefined,
                }
              : {}),
          })),
        });
      }
      // A season's own page and an episode's own page, which the cards of the series open.
      const seasonPage = /^\/api\/v2\/catalog\/items\/season-(\d+)$/.exec(url.pathname);
      if (req.method === 'GET' && seasonPage) {
        const n = Number(seasonPage[1]);
        return send(200, {
          ...baseItem,
          content_id: `season-${n}`,
          type: 'season',
          title: `Season ${n}`,
          series_id: 's1',
          series_title: 'A Show',
          season_number: n,
          air_date: '2008-01-20',
          episode_count: options.episodeCount ?? 2,
          overview: tall
            ? `What happens in season ${n}. ${'It goes on and on, over many lines. '.repeat(20)}`
            : `What happens in season ${n}.`,
          ...(options.posters ? { poster_url: `/img/poster-season${n}.png` } : {}),
          ...(options.seasonCredits
            ? {
                cast: ['Ann Actor', 'Bo Actor'].map((name, order) => ({
                  person_id: `p${order}`,
                  name,
                  character: `Role ${order}`,
                  order,
                })),
                crew: [
                  { person_id: 'c1', name: 'Dana Director', job: 'Director' },
                  { person_id: 'c2', name: 'Wen Writer', job: 'Writer' },
                  { person_id: 'c5', name: 'Sam Screen', job: 'Screenplay' },
                  { person_id: 'c4', name: 'Pia Producer', job: 'Producer' },
                  { person_id: 'c6', name: 'Pat Producer', job: 'Producer' },
                ],
              }
            : {}),
        });
      }
      const episodePage = /^\/api\/v2\/catalog\/items\/e(\d+)(\d)$/.exec(url.pathname);
      if (req.method === 'GET' && episodePage) {
        return send(200, {
          ...baseItem,
          content_id: `e${episodePage[1]}${episodePage[2]}`,
          type: 'episode',
          title: `Episode ${episodePage[1]}.${episodePage[2]}`,
          series_id: 's1',
          series_title: 'A Show',
          season_number: Number(episodePage[1]),
          episode_number: Number(episodePage[2]),
          runtime: 45,
          air_date: `2008-0${episodePage[1]}-${episodePage[2] === '1' ? '20' : '27'}`,
          overview: `Synopsis of ${episodePage[1]}.${episodePage[2]}.`,
          backdrop_url: `/img/still-${episodePage[1]}${episodePage[2]}.png`,
          backdrop_is_episode_still: true,
          // An episode with a file: its Play button is enabled.
          versions: options.pills
            ? trackedFiles(`e${episodePage[1]}${episodePage[2]}`)
            : [
                {
                  file_id: `file-e${episodePage[1]}${episodePage[2]}`,
                  resolution: '1080p',
                  codec_audio: 'eac3',
                  duration: 2700,
                },
              ],
        });
      }
      const episodes = /^\/api\/v2\/catalog\/series\/s1\/seasons\/(\d+)\/episodes$/.exec(
        url.pathname,
      );
      if (req.method === 'GET' && episodes) {
        const season = Number(episodes[1]);
        return send(200, {
          items: Array.from({ length: options.episodeCount ?? 2 }, (_, i) => i + 1).map((n) => ({
            content_id: `e${season}${n}`,
            season_number: season,
            episode_number: n,
            title: `Episode ${season}.${n}`,
            runtime: 45,
            overview: `Synopsis of ${season}.${n}.`,
            ...(options.posters
              ? {
                  still_url: `/img/still-${season}${n}.png`,
                  air_date: `2008-0${season}-${n === 1 ? '20' : '27'}`,
                }
              : {}),
            ...(options.spoilers === undefined
              ? {}
              : {
                  still_url: `/img/still-${season}${n}.png`,
                  still_thumbhash: STILL_THUMBHASH,
                  still_is_episode_still: true,
                  ...(n === 2
                    ? {
                        user_data: {
                          played: true,
                          in_progress_count: 0,
                          unplayed_count: 0,
                          watched_count: 1,
                        },
                      }
                    : {}),
                }),
          })),
        });
      }
      if (withBoxSet && req.method === 'GET') {
        if (url.pathname === '/api/v2/catalog/items/m2/box-set')
          return send(200, { box_set: saga });
        if (url.pathname === '/api/v2/catalog/box-sets/bs1') return send(200, saga);
        if (url.pathname === '/api/v2/catalog/people') {
          const text = (url.searchParams.get('q') ?? '').toLowerCase();
          return send(200, {
            items: 'sage actor'.includes(text) ? [{ id: 'p9', name: 'Sage Actor' }] : [],
          });
        }
        if (url.pathname === '/api/v2/catalog/box-sets') {
          const text = (url.searchParams.get('q') ?? '').toLowerCase();
          const summary = { ...saga, items: undefined };
          return send(200, { items: saga.title.toLowerCase().includes(text) ? [summary] : [] });
        }
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/v2/recommendations/similar/')) {
        return send(200, {
          items: tall
            ? [1, 2, 3, 4].map((n) => ({
                content_id: `sim${n}`,
                title: `Similar ${n}`,
                type: 'movie',
                year: 2020,
              }))
            : [],
        });
      }
      // The person page of a cast member (the tall movie's cast has the ids p0 to p3) or of a
      // crew member (c1 to c6).
      const person = /^\/api\/v2\/catalog\/people\/([pc])(\d)$/.exec(url.pathname);
      if (req.method === 'GET' && person) {
        const names: Record<string, string[]> = {
          p: ['Ann Actor', 'Bo Actor', 'Cy Actor', 'Di Actor'],
          c: [
            '',
            'Dana Director',
            'Wen Writer',
            'Vince Creator',
            'Pia Producer',
            'Sam Screen',
            'Pat Producer',
          ],
        };
        return send(200, {
          id: `${person[1]}${person[2]}`,
          name: names[person[1]!]![Number(person[2])],
          birth_date: '1940-04-25',
          birthplace: 'Springfield, USA',
          bio: options.longBio ? longBio : 'An actor from the fake server.',
        });
      }
      const watch = /^\/api\/v2\/watch\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && watch) {
        if (watch[1] === 'e12') {
          // The second episode of the series: the one Next opens from the rewatch below.
          return send(200, {
            content_id: 'e12',
            title: 'Episode 1.2',
            type: 'episode',
            series_id: 's1',
            series_title: 'A Show',
            season_number: 1,
            episode_number: 2,
            subtitles: [],
            versions: [{ file_id: 'file-e12' }],
          });
        }
        if (watch[1] === 'e9') {
          // The server counts a rewatch as played but keeps its position (the TV finding). It is
          // the first episode of the series, so the player has a next one.
          return send(200, {
            content_id: 'e9',
            title: 'Episode 1.1',
            type: 'episode',
            series_id: 's1',
            series_title: 'A Show',
            season_number: 1,
            episode_number: 1,
            subtitles: [],
            versions: [
              {
                file_id: 'file-e9',
                added_at: '2026-01-01T00:00:00.000Z',
                bitrate: 8000,
                codec_audio: 'aac',
                codec_video: 'h264',
                container: 'mp4',
                duration_seconds: 2700,
                file_size: 1000,
                hdr: false,
                marker_segments: [],
                resolution: '1080p',
                trickplay_available: false,
              },
            ],
            user_data: {
              played: true,
              position_seconds: 600,
              duration_seconds: 2700,
              watched_count: 1,
              unplayed_count: 0,
              in_progress_count: 1,
            },
          });
        }
        return send(200, {
          content_id: watch[1],
          title: 'Played',
          type: 'movie',
          subtitles: [],
          versions: [{ file_id: `file-${watch[1]}` }],
          // The movie of the detail page is half way through; the player reads it fresh.
          ...(watch[1] === 'm2'
            ? {
                user_data: {
                  position_seconds: 1350,
                  duration_seconds: 5400,
                  played: false,
                  watched_count: 0,
                  unplayed_count: 1,
                  in_progress_count: 1,
                },
              }
            : {}),
        });
      }
      // The downloaded subtitles of a file, and the remembered tracks of a title.
      const stored = /^\/api\/v2\/subtitles\/[\w-]+$/.test(url.pathname);
      if (options.pills && req.method === 'GET' && stored) {
        return send(200, {
          subtitles: [
            {
              id: '7',
              media_file_id: url.pathname.split('/').pop(),
              language: 'es',
              format: 'srt',
              provider: 'opensubtitles',
              release_name: 'Second.Title.2021.WEB',
              hearing_impaired: false,
              score: 90,
              created_at: '2026-01-01T00:00:00.000Z',
              timing: { offset_ms: 0, scale: 1 },
            },
          ],
        });
      }
      if (options.pills && /^\/api\/v2\/(audio-prefs|subtitle-prefs)\/[\w-]+$/.test(url.pathname)) {
        res.writeHead(204, cors);
        return res.end();
      }
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/v2/system/info':
          return send(200, { api_major: 2, server_version: 'fake' });
        case 'GET /api/v2/capabilities/metadata-ai':
          if (!options.translation) return send(404, { title: 'not found', status: 404 });
          return send(200, {
            state: 'available',
            allowed: true,
            on_view: options.translation,
            revision: 'r1',
          });
        case 'POST /api/v2/catalog/items/m2/translate-description':
          translated = true;
          return send(202, { id: '1', content_id: 'm2', status: 'pending', target_language: 'de' });
        case 'GET /api/v2/settings/contract/capabilities':
          if (settingsUnknown) return send(404, { title: 'not found', status: 404 });
          return send(200, { state: 'available', allowed: true, manifest_revision: 40 });
        case 'GET /api/v2/settings/values/effective':
          if (settingsUnknown) return send(404, { title: 'not found', status: 404 });
          return send(200, {
            items: url.searchParams.getAll('keys').map((key) => ({
              key,
              value:
                key === 'ui.title_art'
                  ? (options.titleArt ?? true)
                  : key.startsWith('catalog.hide_unwatched')
                    ? (options.spoilers ?? false)
                    : key === 'ui.theme_music_enabled'
                      ? (options.themeMusic ?? false)
                      : key === 'playback.buffering_quality_mode'
                        ? (options.buffering ?? 'always')
                        : key.startsWith('ui.card_overlays')
                          ? null
                          : false,
              source: 'profile',
              definition_revision: 1,
            })),
            revision: 40,
          });
        case 'GET /api/v2/settings/overlay-config':
          if (settingsUnknown) return send(404, { title: 'not found', status: 404 });
          return send(200, {
            enabled: true,
            // The pill preset prefers glyphs, and no item says otherwise.
            defaults: JSON.stringify({ version: 2, preset: 'pill', order: [], items: {} }),
            image_uploads_available: false,
            images: [],
            quick_actions_default: 'both',
            quick_actions_enabled: false,
          });
        case 'PUT /api/v2/settings/values/playback.subtitle_appearance':
          return send(200, {
            key: 'playback.subtitle_appearance',
            scope: 'profile',
            value: JSON.parse(requestBody).value,
            revision: 1,
          });
        case 'DELETE /api/v2/settings/values/playback.subtitle_appearance':
          res.writeHead(204, cors);
          return res.end();
        case 'GET /api/v2/catalog/themes/capabilities':
          return send(200, {
            state: 'available',
            allowed: true,
            delivery: 'local_direct_play',
            transcode: true,
            cluster_routing: false,
            grant_lifetime_seconds: 60,
            revision: 'r1',
          });
        case 'POST /api/v2/catalog/items/42/themes/5/playback':
          // The grant points at a file the mock never serves: the app must stay quiet.
          return send(200, {
            url: '/audio/theme-grant.mp3',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            delivery: 'original',
            content_type: 'audio/mpeg',
          });
        case 'GET /api/v2/auth/providers':
          return send(200, {
            items: [
              { id: 'local', display_name: 'Silo account', mode: 'credentials', default: true },
            ],
            password_login: password,
          });
        case 'POST /api/v2/auth/login':
          return send(200, tokens);
        case 'POST /api/v2/auth/refresh':
          // After a relaunch the app holds only the refresh token and asks for an access token.
          return send(200, tokens);
        case 'POST /api/v2/auth/logout':
          res.writeHead(204, cors);
          return res.end();
        case 'GET /api/v2/auth/device/capability':
          return send(200, { state: code ? 'available' : 'disabled', allowed: code, cancel: true });
        case 'POST /api/v2/auth/device/start':
          return send(201, {
            device_code: 'fake-device-code',
            user_code: '4821-7730',
            verification_uri: 'https://silo.example.test/activate',
            verification_uri_complete: 'https://silo.example.test/activate?code=48217730',
            interval: 1,
            expires_in: 900,
            expires_at: new Date(Date.now() + 900_000).toISOString(),
          });
        case 'POST /api/v2/auth/device/poll':
          polls += 1;
          if (polls < 2) {
            return send(200, { status: 'pending', opened: false, poll_after: 1 });
          }
          return send(200, {
            status: 'approved',
            opened: true,
            poll_after: 1,
            profile_id: '',
            profile_token: '',
            temporary: false,
            tokens,
          });
        case 'GET /api/v2/profiles':
          return send(200, { items: profiles });
        case 'POST /api/v2/profiles': {
          const input = JSON.parse(requestBody) as {
            name: string;
            pin?: string;
            is_child?: boolean;
          };
          const created: FakeProfile = {
            id: `profile-${profiles.length + 1}`,
            name: input.name,
            has_pin: Boolean(input.pin),
            is_primary: false,
            is_child: input.is_child === true,
          };
          profiles.push(created);
          return send(201, created);
        }
        case 'POST /api/v2/profiles/profile-2/verify-pin':
          return send(200, { valid: true, expires_at: null, profile_token: 'pvt-fake' });
        case 'GET /api/v2/theme/branding':
          return send(200, {
            server_name: name,
            login_subtitle: '',
            accent_color: '#e5a00d',
            storage_available: false,
          });
        case 'GET /api/v2/user/libraries':
          return send(200, {
            items: [
              { id: 'lib-1', name: 'Movies', type: 'movies' },
              ...(withSeriesLibrary ? [{ id: 'lib-2', name: 'Shows', type: 'series' }] : []),
            ],
          });
        case 'GET /api/v2/playback/capabilities':
          return send(200, {
            state: 'available',
            allowed: true,
            protocol_versions: [3],
            features: ['sequenced_progress_v1'],
            installation_id: 'install-1',
            deliveries: [],
            revision: 'r',
          });
        case 'POST /api/v2/playback/start':
          return send(201, {
            outcome: 'playable',
            protocol_version: 3,
            session_id: 'e2e-session',
            playback_plan: {
              plan_id: 'plan:1',
              plan_attempt_key: 'v3:1',
              delivery: 'original_http',
              session_id: 'e2e-session',
              selected_tracks: {},
              effective_recipe: options.buffering ? { bitrate_kbps: 10_000 } : {},
              // A quality choice, so the options panel has a Video tab.
              available_qualities: [{ label: '1080p', preserves_source: false }],
              source: { duration_seconds: 5400 },
              stream: { container: 'mp4', url: '/api/v2/stream/e2e-session?st=x' },
              timeline: { player_start_seconds: 0, timeline_offset_seconds: 0 },
            },
          });
        case 'POST /api/v2/playback/e2e-session/replan':
          return send(200, {
            outcome: 'playable',
            protocol_version: 3,
            session_id: 'e2e-session',
            playback_plan: {
              plan_id: 'plan:2',
              plan_attempt_key: 'v3:2',
              delivery: 'original_http',
              session_id: 'e2e-session',
              selected_tracks: {},
              effective_recipe: { bitrate_kbps: 5000 },
              degradation_warnings: [],
              available_qualities: [{ label: '1080p', preserves_source: false }],
              source: { duration_seconds: 5400 },
              stream: { container: 'mp4', url: '/api/v2/stream/e2e-session?st=y' },
              timeline: { player_start_seconds: 0, timeline_offset_seconds: 0 },
            },
          });
        case 'POST /api/v2/playback/e2e-session/progress':
          return send(200, { outcome: 'applied' });
        case 'DELETE /api/v2/playback/e2e-session':
          return send(200, { outcome: 'stopped' });
        case 'GET /api/v2/stream/e2e-session':
          // The media never answers: the player keeps its loading cue.
          return;
        case 'GET /api/v2/home/capabilities':
          // The request just hangs, like the media stream below.
          if (options.homeCapabilitiesNeverAnswer) return;
          return send(200, {
            state: 'available',
            allowed: true,
            revision: 'r',
            section_item_limit_max: 100,
            row_item_limit_max: 100,
          });
        case 'GET /api/v2/home/sections/trending/items':
          return send(200, featuredSection('trending'));
        case 'GET /api/v2/library/lib-1/sections/lib-trending/items':
          return send(200, featuredSection('lib-trending'));
        case 'GET /api/v2/home/sections':
          return send(200, {
            sections: [
              ...(options.featured ? [featuredSection('trending')] : []),
              {
                id: 'continue_watching',
                section_type: 'continue_watching',
                title: 'Continue Watching',
                title_key: 'home.section.continueWatching',
                items: [
                  {
                    content_id: 'm2',
                    title: 'Second Title',
                    type: 'movie',
                    position_seconds: 1350,
                    duration_seconds: 5400,
                    item_source: 'in_progress',
                    overview: 'The second title, half way through.',
                    ...(options.badges ? { overlay_summary: { resolution: '2160p' } } : {}),
                  },
                  ...(withRewatch
                    ? [
                        {
                          content_id: 'e9',
                          title: 'Episode 1.9',
                          type: 'episode',
                          series_id: 's1',
                          series_title: 'A Show',
                          season_number: 1,
                          episode_number: 9,
                          position_seconds: 600,
                          duration_seconds: 2700,
                          item_source: 'in_progress',
                        },
                      ]
                    : []),
                  ...(withLongRow
                    ? Array.from({ length: 25 }, (_, i) => ({
                        content_id: `x${i + 1}`,
                        title: `Extra ${i + 1}`,
                        type: 'movie',
                        position_seconds: 600,
                        duration_seconds: 5400,
                        item_source: 'in_progress',
                      }))
                    : []),
                ],
                total_count: withRewatch ? 2 : 1,
              },
              {
                id: 'recently_added',
                section_type: 'recently_added',
                title: 'Recently Added',
                title_key: 'home.section.recentlyAdded',
                items: [
                  ...(withSeries
                    ? [
                        {
                          content_id: 's1',
                          title: 'A Show',
                          type: 'series',
                          year: 2020,
                          ...(options.badges
                            ? {
                                user_state: {
                                  in_watchlist: false,
                                  is_favorite: false,
                                  not_interested: false,
                                  played: false,
                                  watched_count: 1,
                                  unplayed_count: 3,
                                },
                              }
                            : {}),
                        },
                      ]
                    : []),
                  {
                    content_id: 'm1',
                    title: 'First Title',
                    type: 'movie',
                    year: 2019,
                    ...(options.badges
                      ? {
                          overlay_summary: {
                            resolution: '1080p',
                            hdr: 'DV',
                            audio: 'EAC3',
                            release_type: 'BluRay',
                          },
                          user_state: {
                            in_watchlist: false,
                            is_favorite: false,
                            not_interested: false,
                            played: true,
                          },
                        }
                      : {}),
                  },
                  { content_id: 'm3', title: 'Third Title', type: 'movie', year: 2020 },
                ],
                total_count: 40,
              },
            ],
          });
        case 'GET /api/v2/catalog':
          // A text search: the titles that contain the text, "Saga One" and "Saga Three" for "sag".
          if (url.searchParams.has('q')) {
            const text = (url.searchParams.get('q') ?? '').toLowerCase();
            const found = [
              ...MOVIES.map((movie) => asCard(movie)),
              ...sagaFilms.map((film) => ({
                content_id: film.content_id,
                title: film.title,
                type: film.type,
                year: film.year,
              })),
            ]
              .filter((card) => card.title.toLowerCase().includes(text))
              .filter(
                (card, i, all) => all.findIndex((c) => c.content_id === card.content_id) === i,
              );
            return send(200, {
              items: found,
              total: found.length,
              total_exact: true,
              window_cursor: 'w',
              page: { has_more: false },
            });
          }
          // A person's credits: newest first; "video" is movies and series together.
          if (url.searchParams.get('source') === 'person') {
            const credit = (id: string, title: string, type: string, year: number) => ({
              content_id: id,
              title,
              type,
              year,
            });
            const movies = [
              credit('m1', 'First Title', 'movie', 2022),
              credit('m2', 'Second Title', 'movie', 2021),
            ];
            const series = [credit('s1', 'A Show', 'series', 2020)];
            const kind = url.searchParams.get('type');
            const items =
              kind === 'movie' ? movies : kind === 'series' ? series : [...movies, ...series];
            return send(200, {
              items: items.slice(0, Number(url.searchParams.get('limit') ?? 50)),
              total: items.length,
              total_exact: true,
              page: { has_more: false },
            });
          }
          // A row's full list (Explore all) comes through the catalog with source=section.
          if (url.searchParams.get('source') === 'section') {
            return send(200, {
              items: [
                { content_id: 'm1', title: 'First Title', type: 'movie', year: 2019 },
                { content_id: 'm3', title: 'Third Title', type: 'movie', year: 2020 },
                { content_id: 'm4', title: 'Fourth Title', type: 'movie', year: 2021 },
              ],
              total: 3,
              total_exact: true,
              page: { has_more: false },
            });
          }
          if (url.searchParams.get('library_id') === 'lib-1') {
            if (
              options.noWatchRules &&
              (url.searchParams.get('groups') ?? '').includes('"watched"')
            )
              return send(422, { type: 'about:blank', title: 'Unprocessable', status: 422 });
            const items = browseTitles(url.searchParams).map((movie) =>
              asCard(movie, options.badges),
            );
            return send(200, {
              items,
              total: items.length,
              total_exact: true,
              window_cursor: 'w',
              page: { has_more: false },
            });
          }
          return send(200, {
            items: [
              { content_id: 'm1', title: 'First Title', type: 'movie', year: 2019 },
              { content_id: 'm2', title: 'Second Title', type: 'movie', year: 2021 },
            ],
            total: 2,
            total_exact: true,
          });
        // The Movies and Series tabs: Recommended rows, the facets, the letters, the collections.
        case 'GET /api/v2/library/lib-1/sections':
          return send(200, {
            sections: [
              ...(options.featured ? [featuredSection('lib-trending')] : []),
              {
                id: 'rec',
                section_type: 'recently_added',
                title: 'Recommended for You',
                title_key: 'home.section.recommendedForYou',
                featured: false,
                item_limit: 20,
                is_custom: false,
                customized: false,
                total_count: 2,
                items: MOVIES.slice(0, 2).map((movie) => asCard(movie)),
              },
            ],
          });
        case 'GET /api/v2/library/lib-2/sections':
          return send(200, { sections: [] });
        case 'GET /api/v2/catalog/search/capabilities':
          return send(200, {
            allowed: true,
            revision: 'r',
            state: 'available',
            extended_query_rules: true,
            ...(withBoxSet ? { box_sets: true, people_media_scope: true } : {}),
          });
        case 'GET /api/v2/catalog/filters':
          return send(200, {
            genres: genreNames,
            studios: [],
            networks: [],
            countries: [],
            original_languages: [],
            content_ratings: ['FSK 12', 'FSK 16', 'FSK 18'],
            authors: [],
            narrators: [],
            series: [],
          });
        case 'POST /api/v2/catalog/letters': {
          const body = JSON.parse(requestBody || '{}') as { groups?: FakeGroup[] };
          const counts = new Map<string, number>();
          const matching = filterTitles(body.groups ?? []);
          for (const movie of matching) {
            const letter = movie.title[0]!.toUpperCase();
            counts.set(letter, (counts.get(letter) ?? 0) + 1);
          }
          // One block per letter, in title order; a block starts after the titles before it.
          let position = 0;
          const runs = [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([letter, count]) => {
              const run = { letter, count, position };
              position += count;
              return run;
            });
          return send(200, {
            total: matching.length,
            letters: runs,
            runs: runs.map(({ letter, position: start }) => ({ letter, position: start })),
          });
        }
        case 'GET /api/v2/library/lib-2/collections': {
          const card = {
            id: 'c1',
            title: 'Space Saga',
            poster_url: '',
            item_count: 1,
            poster_is_collage: false,
            featured: false,
          };
          return send(200, {
            library_id: 'lib-2',
            collections: [],
            groups: [
              {
                id: 'g1',
                name: 'Franchises',
                kind: 'server',
                sort_mode: 'manual',
                sort_order: 0,
                collections: [card],
              },
            ],
          });
        }
        case 'GET /api/v2/library/lib-2/collections/c1/items':
          return send(200, {
            items: [{ content_id: 's1', title: 'A Show', type: 'series', year: 2020 }],
            page: { has_more: false },
          });
        default:
          return send(404, { title: 'not found', status: 404 });
      }
    };
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

test.afterAll(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
});

test('server entry, code sign-in, single profile and the first list, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo();
  await page.goto(`${distIndexUrl}?server=${origin}`);

  // Server screen: the input is pre-filled and focused; Down moves to Connect, Enter submits.
  await expect(page.getByLabel('Serveradresse')).toHaveValue(origin);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Verbinden' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Sign-in screen: the code is grouped, and a QR code is shown.
  await expect(page.getByTestId('user-code')).toHaveText('4821 7730');
  await expect(page.getByTestId('qr')).toBeVisible();
  await expect(page.getByTestId('verification-url')).toHaveText(
    'https://silo.example.test/activate',
  );

  // Approved on the second poll: the single profile is selected and the shell shows, on Home.
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /First Title/ })).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Weiterschauen', 'Kürzlich hinzugefügt']);
  // The hero shows the first card; the landscape card has a progress bar of a quarter.
  await expect(page.getByTestId('hero-title')).toHaveText('Second Title');
  await expect(page.getByTestId('hero-synopsis')).toHaveText('The second title, half way through.');
  await expect(page.getByTestId('card-progress')).toHaveAttribute('style', /width: 25%/);
  // The bar is 6 px high and inset 10 px from the art's left, right and bottom edge; the fill
  // follows the position (a quarter of the inner width).
  const geometry = await page.getByTestId('card-progress').evaluate((fill) => {
    const track = fill.parentElement!;
    const art = track.parentElement!.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    return {
      height: t.height,
      left: t.left - art.left,
      right: art.right - t.right,
      bottom: art.bottom - t.bottom,
      ratio: fill.getBoundingClientRect().width / (t.width - 2),
    };
  });
  expect(geometry).toMatchObject({ height: 6, left: 10, right: 10, bottom: 10 });
  expect(geometry.ratio).toBeCloseTo(0.25, 1);
  await expect(page.getByTestId('server-name')).toHaveText('E2E Silo');
  // The server's accent is applied: it only colours the underline of the selected tab.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect
    .poll(() =>
      page.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent')`),
    )
    .toBe('#e5a00d');
  // The Home tab has the focus; Down enters the first row (Continue Watching).
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  // Down to the next row: its first card has the focus, and the hero follows once it rests.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await expect(page.getByTestId('hero-title')).toHaveText('First Title');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Third Title/ })).toBeFocused();
  await expect(page.getByTestId('hero-title')).toHaveText('Third Title');

  // The row shows two of 40 titles and ends with Explore all: OK opens the row's grid.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Alle entdecken/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('section-grid-title')).toHaveText('Kürzlich hinzugefügt');
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Third Title/ })).toBeFocused();
  const gridRequest = seen.find(
    (e) => e.path === '/api/v2/catalog' && e.search.includes('source=section'),
  );
  expect(gridRequest?.search).toContain('section_id=recently_added');
  expect(gridRequest?.search).toContain('scope=home');
  // Back returns to Home, on the Explore all card it was opened from.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByRole('button', { name: /Alle entdecken/ })).toBeFocused();

  // Up to Continue Watching: OK on the movie opens its page (tapped, not held), which offers to
  // resume where the profile stopped.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.locator('.detail-chip')).toHaveText(['2021', '1 Std. 30 Min.']);
  // Like the web app: one Play button with the played share inside it; OK asks what to do.
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await expect(page.getByTestId('detail-primary')).toHaveText('Abspielen');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('resume-dialog')).toContainText(
    'Du bist bei 22:30, etwa 25 % geschafft.',
  );
  await expect(page.getByRole('button', { name: 'Bei 22:30 fortsetzen' })).toBeFocused();
  // Resume starts the playback without asking again, at that position minus the default rewind
  // of 7 s.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-cue')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/playback/start')).toBe(true);
  const resumeStart = seen.find((e) => e.path === '/api/v2/playback/start');
  expect(JSON.parse(resumeStart?.body ?? '{}')).toMatchObject({ start_position: 1343 });

  // Back leaves the player: the session is stopped and the page has its focus on Play again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  // Back again returns to Home, on the card that opened the page.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  // Leaving while the start is still in flight ends the session when its answer arrives, 2 s after
  // the video was unloaded (STOP_AFTER_UNLOAD_MS); the default 5 s is too tight on a slow machine.
  await expect
    .poll(
      () => seen.some((e) => e.method === 'DELETE' && e.path === '/api/v2/playback/e2e-session'),
      { timeout: 15_000 },
    )
    .toBe(true);

  // The authenticated calls carried the token and the profile.
  const home = seen.find((entry) => entry.path === '/api/v2/home/sections');
  expect(home?.authorization).toBe('Bearer fake-access');
  expect(home?.profileId).toBe('profile-1');
  // The rows do not wait for the capabilities, so the first request has no item_limit; the rows
  // were asked for at widths that fit the cards.
  expect(home?.search).not.toContain('item_limit');
  expect(home?.search).toContain('poster_width=352');
  // Playback went through protocol v3 with the same credentials.
  const start = seen.find((entry) => entry.path === '/api/v2/playback/start');
  expect(start?.authorization).toBe('Bearer fake-access');
  expect(start?.profileId).toBe('profile-1');
  // A video element cannot set headers: the media request carries the token as a query parameter.
  await expect
    .poll(() => seen.find((entry) => entry.path === '/api/v2/stream/e2e-session')?.search)
    .toBe('?st=x&token=fake-access');
  expect(seen.filter((entry) => entry.path === '/api/v2/auth/device/poll')).toHaveLength(2);

  // Shell, keyboard only: Back in a row moves the focus to the Home tab.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  // Right moves across the tabs; the content changes only on OK.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filme', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Serien', exact: true })).toBeFocused();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('tab-home')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-series')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Serien', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Für dich', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('coming-soon')).toHaveText(/Kommt bald/);
  // Down reaches the placeholder in the content, Up returns to the tab.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Zur Startseite' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Für dich', exact: true })).toBeFocused();
  // Calendar, Search, then the avatar; OK opens its menu, Back closes it.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const avatar = page.getByRole('button', { name: /Profilmenü für/ });
  await expect(avatar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('avatar-menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('avatar-menu')).toHaveCount(0);
  await expect(avatar).toBeFocused();
  // Back on the bar goes to Home, and on Home it asks to exit.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await expect(page.getByTestId('tab-home')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveText(/App beenden?/);
});

test('Settings: rewind 15 s from the avatar menu, then a Continue Watching rewatch resumes 15 s before its saved position without asking', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ rewatch: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();

  // The avatar menu: Switch profile, Profile at launch, then Settings.
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  // The screen opens on its first row (language); Down twice reaches the rewind row, which is
  // entered on the saved pill (7 s). The arrows only move the highlight, OK selects.
  await expect(page.getByRole('radio', { name: 'Automatisch (wie Fernseher)' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: '7 s' })).toBeFocused();
  await expect(page.getByRole('radio', { name: '7 s' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '15 s' })).toBeFocused();
  await expect(page.getByRole('radio', { name: '7 s' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: '15 s' })).toHaveAttribute('aria-checked', 'true');
  // Back returns to the shell with the avatar focused; the next Back goes to the Home tab.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  // Home's first row is in; a Down before that has no row to enter (the skeleton takes no focus).
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();

  // The rewatch card of Continue Watching plays at once, 15 s before the saved 600 s.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('resume-prompt')).toHaveCount(0);
  await expect
    .poll(() => {
      const start = seen.find((e) => e.path === '/api/v2/playback/start');
      return start ? (JSON.parse(start.body) as { start_position?: number }).start_position : null;
    })
    .toBe(585);
});

test('Settings: subtitle appearance dialog from the avatar menu, change the size, Back lands on its entry and the change was written for the profile', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ rewatch: true, subtitles: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();

  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();

  // The profile's playback section comes first: the auto-play row has the focus, the subtitle
  // entry (with its one-line summary) is right below it.
  // (The fake answers false for a setting it does not know, so the saved pill is Off.)
  await expect(
    page.getByTestId('settings-autoplay').getByRole('radio', { name: 'Aus' }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const opener = page.getByTestId('settings-subtitles');
  await expect(opener).toBeFocused();
  await expect(opener).toContainText('Groß · Weiß · Box');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Darstellung der Untertitel' });
  await expect(dialog).toBeVisible();
  const size = page.getByTestId('subtitle-dialog-size');
  await expect(size).toBeFocused();
  await expect(size.getByRole('radio', { name: 'Groß', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const sample = page.getByText('Franz jagt im komplett');
  await expect(sample).toBeVisible();
  // The preview draws the cues at their size over the video: Large is 48 px at 1080p.
  await expect(sample).toHaveCSS('font-size', '48px');
  await page.keyboard.press('ArrowRight');
  await expect(size.getByRole('radio', { name: 'Sehr groß' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(sample).toHaveCSS('font-size', '60px');
  // Move on to the font colour and change it too, as a viewer would before leaving.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByTestId('subtitle-dialog-fontColor').getByRole('radio', { name: 'Gelb' }),
  ).toHaveAttribute('aria-checked', 'true');

  // Back closes the dialog and the focus is on the entry again; each change was written for the
  // profile (all devices), and this TV's own value dropped.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  await expect(opener).toBeFocused();
  await expect(opener).toContainText('Sehr groß · Gelb · Box');
  await expect
    .poll(() => {
      const write = seen.find(
        (e) =>
          e.method === 'PUT' && e.path === '/api/v2/settings/values/playback.subtitle_appearance',
      );
      return write
        ? write.search +
            ' ' +
            (JSON.parse(write.body) as { value: { fontSize: string } }).value.fontSize
        : null;
    })
    .toBe('?scope=profile xlarge');
  await expect
    .poll(() =>
      seen.some(
        (e) =>
          e.method === 'DELETE' &&
          e.path === '/api/v2/settings/values/playback.subtitle_appearance' &&
          e.search === '?scope=profile_device',
      ),
    )
    .toBe(true);
});

test('Home to a series, a season, an episode and Back to each card, then play the season, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });

  // Down to Recently Added; its first card is the series, OK opens its page.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  // Home's first row is in; a Down before that has no row to enter (the skeleton takes no focus).
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  // The server's play target (S1 E1) is on Play; the seasons are a row of cards, no grid.
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await expect(page.getByTestId('season-label')).toHaveText(['Staffel 1', 'Staffel 2']);
  await expect(page.getByTestId('season-count')).toHaveText(['2 Folgen', '2 Folgen']);
  await expect(page.getByTestId('seasons-head-total')).toHaveText('2 insgesamt');
  await expect(page.getByTestId('episode-grid')).toHaveCount(0);

  // Down to the first season, Right to the second, OK opens its page: the series title with the
  // path above it, the season's chips and overview, and the grid of its episodes.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Staffel 2/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 2');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  await expect(page.locator('.detail-chip')).toHaveText(['2008', 'Staffel 2', '2 Folgen']);
  await expect(page.getByTestId('detail-synopsis')).toHaveText('What happens in season 2.');
  await expect(page.getByTestId('episode-title')).toHaveText([
    'S02F01 · Episode 2.1',
    'S02F02 · Episode 2.2',
  ]);
  await expect(page.getByTestId('episodes-head-total')).toHaveText('2 insgesamt');
  await expect(page.getByRole('button', { name: 'Erste Folge abspielen' })).toBeFocused();

  // Down into the grid, onward to the second episode, OK opens that episode's page.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 2.1/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Episode 2.2/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Episode 2.2');
  expect(seen.some((e) => e.path === '/api/v2/catalog/items/e22')).toBe(true);
  // Opening a page never plays.
  expect(seen.some((e) => e.path === '/api/v2/watch/e22')).toBe(false);

  // Back: the season page, and the same episode card has the focus.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 2');
  await expect(page.getByRole('button', { name: /Episode 2.2/ })).toBeFocused();
  // Back again: the series page, and the second season card has the focus.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await expect(page.getByRole('button', { name: /Staffel 2/ })).toBeFocused();

  // OK on the season again, then Play on the season page plays its first episode.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Erste Folge abspielen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/watch/e21')).toBe(true);
  // Back from the player: the season page, on its Play button.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 2');
  await expect(page.getByRole('button', { name: 'Erste Folge abspielen' })).toBeFocused();
});

test('Season page to an episode page, its More Episodes row, a sibling and Back to each card, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1');

  // Down into the grid, OK on the first episode: its page, with the path, no poster and the
  // episode's own actions; the focus is on the primary button.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Episode 1.1');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1Folge 1');
  await expect(page.getByTestId('detail-poster')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Folge abspielen' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Weitere Folgen' })).toBeVisible();
  await expect(page.getByTestId('episode-now')).toHaveText('Aktuell');

  // Down: the pills row (this file has subtitles only); Down again: the current episode's card.
  // Right: the next one. OK opens its page.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Episode 1.2/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1Folge 2');
  await expect(page.getByTestId('detail-title')).toHaveText('Episode 1.2');
  // A page opened from a sibling card starts on its own card in the row, not on Play.
  await expect(page.getByRole('button', { name: /Episode 1.2/ })).toBeFocused();

  // Back: the first episode's page with the card we came from focused; Back again: the season
  // page with the first episode's card focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1Folge 1');
  await expect(page.getByRole('button', { name: /Episode 1.2/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
});

test('Movies: Browse filtered by watch state with the remote; an older server shows no Status section', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo();
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  const posters = page.getByTestId('card-title');
  await expect(posters).toHaveCount(6);

  // Filter, then Status (the third facet): "Gesehen" is one choice; Back leaves it, Back applies.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Status/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^Status/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Alle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Gesehen', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Gesehen', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Status/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-panel')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  // The grid shows the server's answer: the watched titles.
  await expect(posters).toHaveText(['Alpha Title', 'First Title', 'Third Title']);
  const sent = seen.filter((e) => e.path === '/api/v2/catalog' && e.search.includes('watched'));
  const last = new URLSearchParams(sent[sent.length - 1]?.search ?? '');
  expect(JSON.parse(last.get('groups') ?? '[]')).toEqual([
    { match: 'any', rules: [{ field: 'watched', op: 'is', value: true }] },
  ]);
});

test('Movies: a server that answers the watch-rule probe with 422 shows no Status section', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ noWatchRules: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByTestId('card-title')).toHaveCount(6);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Altersfreigabe/ })).toBeVisible();
  expect(seen.some((e) => e.path === '/api/v2/catalog' && e.search.includes('watched'))).toBe(true);
  await expect(page.getByRole('button', { name: /^Status/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Movies: Browse filtered by two content ratings with the remote, then Back to the grid', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo();
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Mediathek' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  const posters = page.getByTestId('card-title');
  await expect(posters).toHaveCount(6);

  // Filter, then Altersfreigabe (the fourth facet, after the Status section the probe let in): two values; Back leaves the values, Back applies.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Status/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /^Altersfreigabe/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'FSK 12' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'FSK 16' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemcheckbox', { name: 'FSK 18' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Altersfreigabe/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-panel')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  // The grid shows the server's answer: the titles rated FSK 16 or FSK 18.
  await expect(posters).toHaveText(['Fourth Title', 'Second Title', 'Seventh Title']);
  const rated = seen.filter(
    (e) => e.path === '/api/v2/catalog' && e.search.includes('content_rating='),
  );
  const params = new URLSearchParams(rated[rated.length - 1]?.search ?? '');
  expect(params.getAll('content_rating')).toEqual(['FSK 16', 'FSK 18']);
  // Back closed the panel onto the Filter pill; the grid is one Down away.
  await expect(page.getByRole('button', { name: /^Filter/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Fourth Title/ })).toBeFocused();
});

test('Movies: Browse sorted by year, filtered by genre, a letter jump, a detail and Back to the same poster; Series: Collections', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ seriesLibrary: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();

  // Movies: OK on the tab shows it at once; Down reaches the sub-view pills (Recommended is open).
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filme', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  // Right onto Browse and OK: the library's titles, A to Z.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Mediathek' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  const posters = page.getByTestId('card-title');
  await expect(posters).toHaveText([
    'Alpha Title',
    'First Title',
    'Fourth Title',
    'Second Title',
    'Seventh Title',
    'Third Title',
  ]);

  // Sort by year: the list marks the current sort; Year starts with the newest.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Sortierung · Titel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /^Titel/ })).toBeFocused();
  await expect(page.getByRole('menuitemradio', { name: /^Titel/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /^Jahr/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sortierung · Jahr' })).toBeFocused();
  await expect(posters).toHaveText([
    'Second Title',
    'Third Title',
    'First Title',
    'Fourth Title',
    'Seventh Title',
    'Alpha Title',
  ]);
  expect(seen.some((e) => e.path === '/api/v2/catalog' && e.search.includes('sort=-year'))).toBe(
    true,
  );

  // Filter by genre: the facet's values are checkboxes; Back leaves them, Back again applies.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Action' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Action' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-panel')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(posters).toHaveText(['Second Title', 'Fourth Title', 'Seventh Title']);
  const filtered = seen.filter((e) => e.path === '/api/v2/catalog' && e.search.includes('groups='));
  expect(decodeURIComponent(filtered[filtered.length - 1]?.search ?? '')).toContain('"Action"');

  // The alphabet rail only exists in title order: back to Title (the sort pill is a Left away).
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Sortierung · Jahr' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /^Jahr/ })).toBeFocused();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitemradio', { name: /^Titel/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Sortierung · Titel' })).toBeFocused();
  await expect(posters).toHaveText(['Fourth Title', 'Second Title', 'Seventh Title']);
  // Only F and S have titles now. Right from the last poster reaches the rail.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Fourth Title/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Seventh Title/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(`document.activeElement?.getAttribute('aria-label')`))
    .toMatch(/^Springe zu /);
  for (let i = 0; i < 30; i += 1) {
    const label = await page.evaluate(`document.activeElement?.getAttribute('aria-label')`);
    if (label === 'Springe zu S') break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(page.getByRole('button', { name: 'Springe zu S' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Springe zu B' })).toBeDisabled();
  // OK jumps to S and leaves the list whole; the focus stays on the rail. Left enters the grid.
  await page.keyboard.press('Enter');
  await expect(posters).toHaveText(['Fourth Title', 'Second Title', 'Seventh Title']);
  await expect(page.getByRole('button', { name: 'Springe zu S' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Springe zu S' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(seen.some((e) => e.path === '/api/v2/catalog' && e.search.includes('name_prefix'))).toBe(
    false,
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();

  // Open a title; Back returns to the same poster with the same sort and filter.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect(posters).toHaveText(['Fourth Title', 'Second Title', 'Seventh Title']);
  await expect(page.getByTestId('filter-count')).toHaveText('1');

  // Back from the poster: the sub-view pills, then the tab bar.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Mediathek' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Filme', exact: true })).toBeFocused();

  // Series: the Collections view lists the library's collections; OK opens one as a page.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-series')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Sammlungen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('card-title')).toHaveText(['Space Saga']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Space Saga/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('collection-title')).toHaveText('Space Saga');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  // Back: the collection's poster has the focus again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('collections')).toBeVisible();
  await expect(page.getByRole('button', { name: /Space Saga/ })).toBeFocused();
});

test('profiles: picker with a PIN profile, create a kids profile, choose it, open it automatically on the next start', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({
    profiles: [
      { id: 'profile-1', name: 'Alex', has_pin: false, is_primary: true, is_child: false },
      { id: 'profile-2', name: 'Sam', has_pin: true, is_primary: false, is_child: false },
    ],
  });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Verbinden' })).toBeFocused();
  await page.keyboard.press('Enter');

  // The picker has both profiles, a lock on the PIN profile, and the Add profile tile last.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wer schaut?');
  const alex = page.getByRole('button', { name: /Alex/ });
  const sam = page.getByRole('button', { name: /Sam/ });
  await expect(alex).toBeFocused();
  await expect(alex).toHaveClass(/is-focused/);
  await expect(sam.getByTestId('lock-badge')).toBeVisible();
  await expect(alex.getByTestId('lock-badge')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(sam).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const add = page.getByRole('button', { name: 'Profil hinzufügen' });
  await expect(add).toBeFocused();

  // New profile: a name, a kids profile, Save with the keyboard only.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neues Profil');
  await expect(page.getByLabel('Profilname')).toBeFocused();
  await page.keyboard.type('Mia');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel(/^PIN/)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const kids = page.getByRole('switch', { name: /Kinderprofil/ });
  await expect(kids).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(kids).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Profil erstellen' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Back on the picker: Mia is there with a Kids badge and has the focus.
  const mia = page.getByRole('button', { name: /Mia/ });
  await expect(mia).toBeFocused();
  await expect(mia.getByTestId('kids-badge')).toHaveText('Kinder');
  const created = seen.find((e) => e.method === 'POST' && e.path === '/api/v2/profiles');
  expect(created?.profileId).toBe('profile-1');
  expect(JSON.parse(created?.body ?? '{}')).toEqual({ name: 'Mia', is_child: true });

  // Choose her: the first pick asks whether to open her automatically; Yes.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('launch-offer')).toContainText(
    'Mia nächstes Mal automatisch öffnen?',
  );
  await expect(page.getByRole('button', { name: 'Ja' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('launch-offer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();

  // A kids profile has no Switch server and no Sign out in the avatar menu.
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Profilmenü für Mia' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: /Profil beim Start/ })).toContainText(
    'Automatisch',
  );
  await expect(page.getByRole('menuitem', { name: 'Server wechseln' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Abmelden' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The next start (no server in the launch parameters) opens Mia without the picker.
  await page.goto(distIndexUrl);
  await expect(page.getByTestId('server-name')).toHaveText('E2E Silo', { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Profilmenü für Mia' })).toBeVisible();
  await expect(page.getByTestId('profile-list')).toHaveCount(0);
  // Home's request of this start may still be on its way when the avatar shows: wait for it.
  await expect
    .poll(() => {
      const homes = seen.filter((e) => e.path === '/api/v2/home/sections');
      return homes[homes.length - 1]?.profileId;
    })
    .toBe('profile-3');
});

test('Back on the server screen (the root) opens the exit popup; Cancel closes it', async ({
  page,
}) => {
  await page.goto(distIndexUrl);
  await expect(page.getByTestId('server-screen')).toBeVisible();
  await expect(page.getByLabel('Serveradresse')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveText(/App beenden\?/);
  // Cancel has the focus first; the screen below no longer reacts to the pointer.
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Beenden' })).toBeFocused();
  // The arrow keys cannot leave the popup.
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    await expect(page.getByRole('button', { name: 'Beenden' })).toBeFocused();
  }
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  }

  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The focus is back on the input.
  await expect(page.getByLabel('Serveradresse')).toBeFocused();

  // Back closes the popup as well.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
});

test('the Magic Remote pointer moves the focus and clicks, and the keys continue from there', async ({
  page,
}) => {
  await page.goto(distIndexUrl);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.getByRole('button', { name: 'Verbinden' }).hover();
  await expect(page.getByRole('button', { name: 'Verbinden' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
});

test('the bundled Inter font loads under file://', async ({ page }) => {
  await page.goto(distIndexUrl);
  await expect(page.getByTestId('server-screen')).toBeVisible();
  // A string, not a function: the e2e config has no DOM types.
  const result = (await page.evaluate(`(async () => {
    await document.fonts.ready;
    // Faces load on first use; ask for the four weights the design uses.
    await Promise.all(
      [400, 500, 600, 700].map((weight) => document.fonts.load(weight + ' 26px Inter', 'Aä')),
    );
    const loaded = Array.from(document.fonts)
      .filter((face) => face.family.replace(/["']/g, '') === 'Inter' && face.status === 'loaded')
      .map((face) => face.weight)
      .sort();
    return {
      check: document.fonts.check('600 26px Inter'),
      loaded,
      heading: getComputedStyle(document.querySelector('h1')).fontFamily,
    };
  })()`)) as { check: boolean; loaded: string[]; heading: string };
  expect(result.check).toBe(true);
  expect(result.loaded).toEqual(['400', '500', '600', '700']);
  expect(result.heading).toContain('Inter');
});

// The list row of a server (its Remove button's name starts with the same words).
const serverRow = (page: Page, name: string) => page.locator('button.server', { hasText: name });

// From the Home tab to the avatar (Home, Movies, Series, For you, Calendar, Search, avatar), then
// its menu: "Switch server" is the fourth item.
async function openServerListFromShell(page: Page) {
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  // Profile at launch and Settings sit between Switch profile and Switch server.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Profil beim Start/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Server wechseln' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('server-list')).toBeVisible();
}

test('two servers: code sign-in on A, password sign-in on B, switching and removing, keyboard only', async ({
  page,
}) => {
  const a = await startFakeSilo({ name: 'Silo A', token: 'token-a' });
  const b = await startFakeSilo({ name: 'Silo B', token: 'token-b', code: false, password: true });
  await page.goto(distIndexUrl);

  // Add server A and sign in with a code.
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.type(a.origin);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('user-code')).toHaveText('4821 7730');
  await expect(page.getByTestId('server-name')).toHaveText('Silo A', { timeout: 10_000 });

  // Switch server: the list has A, focused; Add server is below it.
  await openServerListFromShell(page);
  await expect(serverRow(page, 'Silo A')).toBeFocused();
  await expect(page.getByTestId('server-security')).toHaveText('HTTP');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Server hinzufügen' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Add server B: it has no code sign-in, so the password button is the way in and has the focus.
  await expect(page.getByLabel('Serveradresse')).toHaveValue('');
  await page.keyboard.type(b.origin);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('signin-unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mit Passwort anmelden' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('password-screen')).toBeVisible();
  await expect(page.getByLabel('Benutzername')).toBeFocused();
  await page.keyboard.type('test-viewer');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Passwort')).toBeFocused();
  await page.keyboard.type('fake-password-0000');
  await expect(page.getByLabel('Passwort')).toHaveAttribute('type', 'password');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('server-name')).toHaveText('Silo B', { timeout: 10_000 });

  // The sign-in call went to B only, with the typed values; A never saw them.
  const login = b.seen.find((entry) => entry.path === '/api/v2/auth/login');
  expect(JSON.parse(login?.body ?? '{}')).toEqual({
    username: 'test-viewer',
    password: 'fake-password-0000',
  });
  expect(a.seen.some((entry) => entry.path === '/api/v2/auth/login')).toBe(false);
  // B's catalog request carries B's token (the name shows before the titles are asked for).
  await expect
    .poll(() => b.seen.find((entry) => entry.path === '/api/v2/home/sections')?.authorization)
    .toBe('Bearer token-b');

  // Switch back to A through the list: B is current (first), A is the second row; A still has its session.
  await openServerListFromShell(page);
  await expect(serverRow(page, 'Silo B')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(serverRow(page, 'Silo A')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('server-name')).toHaveText('Silo A', { timeout: 10_000 });
  await expect
    .poll(() => {
      const homesOfA = a.seen.filter((entry) => entry.path === '/api/v2/home/sections');
      return homesOfA[homesOfA.length - 1]?.authorization;
    })
    .toBe('Bearer token-a');
  // A was not asked to sign in again: its code flow ran once.
  expect(a.seen.filter((entry) => entry.path === '/api/v2/auth/device/start')).toHaveLength(1);

  // Remove B: Right from its row reaches Remove, the dialog asks, Cancel keeps it, Remove ends it.
  await openServerListFromShell(page);
  await expect(serverRow(page, 'Silo A')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(serverRow(page, 'Silo B')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Silo B entfernen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveText(/Server entfernen\?/);
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Silo B entfernen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Entfernen', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('server-list').locator('.server-row')).toHaveCount(1);
  await expect(serverRow(page, 'Silo B')).toHaveCount(0);
  // B was signed out on its server, and only B's session is gone from the storage.
  await expect
    .poll(
      () =>
        b.seen.find((entry) => entry.method === 'POST' && entry.path === '/api/v2/auth/logout')
          ?.authorization,
    )
    .toBe('Bearer token-b');
  const keys = (await page.evaluate(`Object.keys(localStorage)`)) as string[];
  expect(keys).toContain(`silo-tv.session.v1.${a.origin}`);
  expect(keys).not.toContain(`silo-tv.session.v1.${b.origin}`);
  // A is the one left: Back leaves the list for A's shell.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('server-name')).toHaveText('Silo A');
});

test('player Info (blue key): two columns of readable rows, inside the safe area and above the overlay gradient', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  // The label no longer waits for the episodes (it follows the series' counts), so wait for the
  // pills and the strip before a key moves down to them.
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();

  // Blue is key code 406 on the remote; Playwright has no key name for it. It opens the overlay
  // and Info with the focus on the Info button; no separate diagnostics window exists.
  const blue =
    "document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406, bubbles: true }))";
  await page.evaluate(blue);
  const panel = page.getByTestId('player-info');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('player-diagnostics')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Info' })).toBeFocused();

  // The probe screen's dl rules must not leak in: no 280 px grid, no break-anywhere values.
  const styles = await panel.evaluate((el) => {
    const view = el.ownerDocument.defaultView!;
    const dd = el.querySelector('dd')!;
    return {
      display: view.getComputedStyle(el).display,
      columns: view.getComputedStyle(el).gridTemplateColumns,
      wordBreak: view.getComputedStyle(dd).wordBreak,
    };
  });
  expect(styles.display).toBe('grid');
  expect(styles.columns).not.toContain('280px');
  expect(styles.wordBreak).not.toBe('break-all');

  // Two columns side by side: "now" on the left, the source file on the right.
  const columns = await panel.locator('.player-info-column').evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, title: el.querySelector('h2')!.textContent };
    }),
  );
  expect(columns.map((column) => column.title)).toEqual(['Jetzt', 'Quelldatei']);
  expect(columns[1]!.left).toBeGreaterThanOrEqual(columns[0]!.right);

  const rows = await panel.locator('.player-info-fact').evaluateAll((els) =>
    els.map((el) => {
      const dt = el.querySelector('dt')!.getBoundingClientRect();
      const dd = el.querySelector('dd')!.getBoundingClientRect();
      return {
        label: el.querySelector('dt')!.textContent ?? '',
        dtRight: dt.right,
        ddLeft: dd.left,
        dtTop: dt.top,
        ddTop: dd.top,
        height: el.getBoundingClientRect().height,
        fontSize: parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize),
      };
    }),
  );
  expect(rows.length).toBeGreaterThanOrEqual(10);
  for (const row of rows) {
    // Label and value sit side by side, in this order, on one compact row.
    expect(row.ddLeft, row.label).toBeGreaterThanOrEqual(row.dtRight);
    expect(Math.abs(row.ddTop - row.dtTop), row.label).toBeLessThan(10);
    expect(row.height, row.label).toBeLessThanOrEqual(31);
    expect(row.fontSize, row.label).toBeGreaterThanOrEqual(20);
  }

  // The panel lies inside the screen's safe area, below Exit, about 1100 px wide, and clear of
  // the scrubber and the button row.
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(viewport.width * 0.05 - 1);
  expect(box.y).toBeGreaterThanOrEqual(viewport.height * 0.05 - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width * 0.95 + 1);
  expect(box.width).toBeGreaterThanOrEqual(1000);
  expect(box.width).toBeLessThanOrEqual(1100 + 1);
  const exit = (await page.getByRole('button', { name: 'Beenden' }).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(exit.y + exit.height);
  const scrubber = (await page.getByTestId('player-scrubber').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(scrubber.y);

  // The overlay fades in over 200 ms; measure colours once it is fully there.
  await expect(page.getByTestId('player-osd')).toHaveCSS('opacity', '1');
  // Nothing overflows the panel (the footer's rows included).
  expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

  // Above the overlay's gradient: the panel is a little see-through (78 % of #15171c over the
  // picture), so a spot inside it is at least 0.78 x (21, 23, 28); under the gradient's 88 % black
  // it would be near zero.
  const shot = await page.screenshot({
    clip: { x: box.x + 12, y: box.y + box.height - 10, width: 4, height: 4 },
  });
  const pixel = (await page.evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${shot.toString('base64')}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(1, 1, 1, 1).data);
  })()`)) as number[];
  expect(pixel[0]!).toBeGreaterThanOrEqual(14);
  expect(pixel[1]!).toBeGreaterThanOrEqual(15);
  expect(pixel[2]!).toBeGreaterThanOrEqual(18);
  expect(pixel[0]!).toBeLessThanOrEqual(30);

  // The blue key again closes it.
  await page.evaluate(blue);
  await expect(panel).toHaveCount(0);
});

async function openSeriesDetail(
  page: Page,
  tall = false,
  seasons?: number,
  titleArt?: boolean,
  spoilers?: boolean,
  posters?: boolean,
) {
  const { origin, seen } = await startFakeSilo({
    series: true,
    tall,
    seasons,
    titleArt,
    spoilers,
    posters,
  });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  // The label no longer waits for the episodes (it follows the series' counts), so wait for the
  // seasons row (or the grid of a one-season series) before a key moves down to it.
  await expect(page.getByTestId(seasons === 1 ? 'episode-grid' : 'season-rail')).toBeVisible();
  return { seen };
}

test('detail page: a focused action pill is black on white, a focused season card shows its ring and grows', async ({
  page,
}) => {
  await openSeriesDetail(page);
  const paint = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el);
      return { color: style.color, background: style.backgroundColor };
    });
  const white = { color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' };

  // The focused action pill.
  const play = page.getByRole('button', { name: 'Ab Folge 1 starten' });
  expect(await paint(play)).toEqual(white);

  // The focused season card: the ring is drawn and the poster has grown by 5 %.
  const ring = (card: ReturnType<Page['locator']>) =>
    card
      .locator('.card-ring')
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity);
  const scale = (card: ReturnType<Page['locator']>) =>
    card.locator('.card-art').evaluate((el) => {
      const w = el.ownerDocument.defaultView!;
      return Math.round(new w.DOMMatrix(w.getComputedStyle(el).transform).a * 100);
    });
  await page.keyboard.press('ArrowDown');
  const season1 = page.getByRole('button', { name: /Staffel 1/ });
  await expect(season1).toBeFocused();
  await expect.poll(() => ring(season1)).toBe('1');
  await expect.poll(() => scale(season1)).toBe(105);

  // Another season focused: the first is back to its resting look.
  await page.keyboard.press('ArrowRight');
  const season2 = page.getByRole('button', { name: /Staffel 2/ });
  await expect(season2).toBeFocused();
  await expect.poll(() => ring(season2)).toBe('1');
  await expect.poll(() => ring(season1)).toBe('0');
  await expect.poll(() => scale(season1)).toBe(100);
});

test('detail page: the backdrop stays, the page snaps to the seasons row, the title block is narrow', async ({
  page,
}) => {
  await openSeriesDetail(page);
  const layer = page.getByTestId('detail-backdrop-layer');
  const before = await layer.boundingBox();
  expect(before).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });

  // The hero's title block, beside the cover, ends inside the full-strength shade (1421 px);
  // the synopsis below runs at most 1300 px wide from the cover's left edge.
  const column = await page.locator('.detail-head').boundingBox();
  expect(column!.x + column!.width).toBeLessThanOrEqual(1421);
  const synopsis = await page.getByTestId('detail-synopsis').boundingBox();
  expect(synopsis!.width).toBeLessThanOrEqual(1300);

  // Down to the seasons: the actions are out of view, and no pill reaches into the top
  // safe-area band (54 px).
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  // The page has scrolled (400 ms) when the heading of the row sits on the safe line.
  const head = page.getByTestId('seasons-head');
  await expect.poll(async () => Math.round((await head.boundingBox())!.y)).toBe(54);
  const pills = await page
    .locator('.detail-actions .detail-pill')
    .evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.bottom]),
    );
  expect(pills.length).toBeGreaterThan(0);
  for (const [top, bottom] of pills) {
    expect(bottom <= 0 || top >= 54).toBe(true);
  }
  expect(Math.abs((await head.boundingBox())!.y - 54)).toBeLessThanOrEqual(2);
  expect(await layer.boundingBox()).toEqual(before);
  await expect(page.getByTestId('detail-dim')).toHaveAttribute('data-scrolled', 'true');
});

async function openMovieDetail(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const { origin } = await startFakeSilo({ tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
}

/**
 * The cover top left, as tall as the title block beside it (from its first element's top to its
 * last element's bottom, at least 300 px, 2:3 wide), and the synopsis below both from the cover's
 * left edge. Returns the boxes.
 */
async function expectCoverBesideTitleBlock(page: Page) {
  const poster = (await page.getByTestId('detail-poster').boundingBox())!;
  const head = (await page.locator('.detail-head').boundingBox())!;
  const first = (await page.locator('.detail-head > :first-child').boundingBox())!;
  const last = (await page.locator('.detail-head > :last-child').boundingBox())!;
  const synopsis = (await page.getByTestId('detail-synopsis').boundingBox())!;
  const titleBlockHeight = last.y + last.height - first.y;
  expect(Math.abs(first.y - head.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(poster.y - first.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(poster.height - Math.max(300, titleBlockHeight))).toBeLessThanOrEqual(1);
  expect(Math.abs(poster.width - (poster.height * 2) / 3)).toBeLessThanOrEqual(1);
  expect(Math.round(poster.x)).toBe(100);
  // 40 px between the cover and the title block.
  expect(Math.round(head.x - (poster.x + poster.width))).toBe(40);
  // The synopsis starts at the cover's left edge, below the cover and the title block.
  expect(Math.round(synopsis.x)).toBe(Math.round(poster.x));
  expect(synopsis.y).toBeGreaterThanOrEqual(poster.y + poster.height + 16 - 1);
  expect(synopsis.y).toBeGreaterThanOrEqual(last.y + last.height + 16 - 1);
  return { poster, head, first, last, synopsis };
}

/** The cover beside the title block, the synopsis below them in the wide width, inside the safe area. */
async function expectHeroLayout(page: Page, size: { width: number; height: number }) {
  const { poster, head, synopsis } = await expectCoverBesideTitleBlock(page);
  // The title block is 800 px wide, and in a 1280 px window it ends at the right safe margin (95 %).
  expect(head.x + head.width).toBeLessThanOrEqual(size.width * 0.95 + 1);
  expect(Math.round(head.width)).toBeLessThanOrEqual(800);
  // The synopsis is wider than the old 800 px column, at most 1300 px, and keeps the safe area.
  expect(synopsis.width).toBeGreaterThan(size.width === 1920 ? 800 : 700);
  expect(synopsis.width).toBeLessThanOrEqual(1300);
  expect(synopsis.x + synopsis.width).toBeLessThanOrEqual(size.width * 0.95 + 1);
  // The shade stays at full strength (0.92) up to 74 % of the width, past the widest text (1400 px).
  const shade = await page
    .locator('.detail-shade')
    .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundImage);
  expect(shade).toContain('rgba(0, 0, 0, 0.92) 74%');
  const image = page.getByTestId('detail-poster').locator('img');
  await expect(image).toBeVisible();
  // Nothing in the title block reaches under the cover.
  const left = await page.locator('.detail-head *').evaluateAll((els) =>
    Math.min(
      ...els
        .map((el) => el.getBoundingClientRect())
        // A `display: contents` list has no box of its own.
        .filter((rect) => rect.width > 0)
        .map((rect) => rect.left),
    ),
  );
  expect(left).toBeGreaterThanOrEqual(poster.x + poster.width + 40 - 1);
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
]) {
  test(`detail page: a movie hero has the web's parts, the cover beside the title block and the text below at ${size.width} px`, async ({
    page,
  }) => {
    await openMovieDetail(page, size);
    await expectHeroLayout(page, size);

    await expect(page.getByTestId('detail-kicker')).toHaveText('FilmStudio Ponoc');
    await expect(page.getByTestId('detail-tagline')).toHaveText(
      'Half way through is still on the way.',
    );
    await expect(page.locator('.detail-chip')).toHaveText(['2021', 'PG', '1 Std. 43 Min.']);
    await expect(page.locator('.detail-badge')).toHaveText(['2160P', 'HDR10', 'DTS']);
    await expect(page.locator('.detail-ratings li')).toHaveText([
      'IMDb 8.1',
      'TMDB 7.9',
      'RT 93%',
      'Metacritic 71',
    ]);
    await expect(page.getByTestId('detail-credits')).toHaveText(
      'Regie: Dana Director · Drehbuch: Wen Writer · Drama · Crime',
    );
    // The long synopsis is cut at six lines (36 px each), and Mehr appears. A 720 px window has
    // no room for them: the hero keeps the least, two lines.
    const synopsis = (await page.getByTestId('detail-synopsis').boundingBox())!;
    expect(Math.round(synopsis.height)).toBe(size.height === 1080 ? 216 : 72);
    await expect(page.getByRole('button', { name: 'Mehr' })).toBeVisible();
  });

  test(`detail page: a series hero cuts the synopsis at three lines and counts its seasons at ${size.width} px`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openSeriesDetail(page, true);
    await expectHeroLayout(page, size);

    await expect(page.getByTestId('detail-kicker')).toHaveText('SerieAMC');
    await expect(page.getByTestId('detail-tagline')).toHaveText('A show about a school.');
    await expect(page.locator('.detail-chip')).toHaveText([
      '2008–2013',
      '18',
      '2 Staffeln',
      '4 Folgen',
    ]);
    await expect(page.locator('.detail-badge')).toHaveCount(0);
    await expect(page.getByTestId('detail-credits')).toHaveText(
      'Erstellt von Vince Creator · Drama · Crime · Thriller',
    );
    // Three lines, or the least (two) in a 720 px window, which has no room for the third.
    const synopsis = (await page.getByTestId('detail-synopsis').boundingBox())!;
    expect(Math.round(synopsis.height)).toBe(size.height === 1080 ? 108 : 72);
    await expect(page.getByRole('button', { name: 'Mehr' })).toBeVisible();
  });
}

test('detail page: a movie with a logo, tagline and ratings has its cover exactly as tall as the title block, and the text below it', async ({
  page,
}) => {
  await openLongMovie(page, {});
  const { poster, first, last, synopsis } = await expectCoverBesideTitleBlock(page);
  // The cover runs from the kicker's top to the ratings' bottom.
  const kicker = (await page.getByTestId('detail-kicker').boundingBox())!;
  const ratings = (await page.getByTestId('detail-ratings').boundingBox())!;
  expect(Math.abs(poster.y - kicker.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(poster.y + poster.height - (ratings.y + ratings.height))).toBeLessThanOrEqual(1);
  expect(poster.height).toBeGreaterThan(300);
  expect(first.y).toBe(kicker.y);
  expect(last.y + last.height).toBe(ratings.y + ratings.height);
  // The synopsis takes the wide width, not the title block's 800 px.
  expect(synopsis.width).toBeGreaterThan(800);
  expect(synopsis.width).toBeLessThanOrEqual(1300);
  expect((await heroFit(page)).pillsBottom).toBeLessThanOrEqual(1026);
});

test('detail page: a credit line longer than 1300 px wraps inside the text width', async ({
  page,
}) => {
  await page.route('**/api/v2/catalog/items/m2*', async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    // Long names and many genres make one credit line far wider than 1300 px if nothing caps it
    // (the line names two directors and two writers at most).
    const name = (who: string) => `${who} with a remarkably long name of many parts`;
    item.crew = [
      { person_id: 'c1', name: name('Dana Director'), job: 'Director' },
      { person_id: 'c2', name: name('Dino Director'), job: 'Director' },
      { person_id: 'c3', name: name('Wen Writer'), job: 'Writer' },
      { person_id: 'c4', name: name('Wim Writer'), job: 'Writer' },
    ];
    item.genres = ['Drama', 'Crime', 'Thriller', 'Mystery', 'Adventure', 'Documentary'];
    await route.fulfill({ response, json: item });
  });
  await openLongMovie(page, {});
  // Only 1920 px discriminates: at 1280 px the body is narrower than 1300 px anyway.
  const credits = (await page.getByTestId('detail-credits').boundingBox())!;
  expect(credits.width).toBeLessThanOrEqual(1300);
  expect(credits.x + credits.width).toBeLessThanOrEqual(1400);
  // The line did wrap: it is more than one 31 px line high.
  expect(credits.height).toBeGreaterThan(62);
});

test('detail page: a movie with a short title block has a 300 px cover and the text 16 px below it', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({});
  await openSecondTitle(page, origin);
  await expect(page.getByTestId('detail-tagline')).toHaveCount(0);
  await expect(page.getByTestId('detail-ratings')).toHaveCount(0);
  const { poster, head, synopsis } = await expectCoverBesideTitleBlock(page);
  expect(head.height).toBeLessThan(300);
  expect(Math.round(poster.height)).toBe(300);
  expect(Math.round(poster.width)).toBe(200);
  expect(Math.round(synopsis.y - (poster.y + poster.height))).toBe(16);
});

test('detail page: a series page and a season page have the cover beside the title block', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  const series = await expectCoverBesideTitleBlock(page);
  expect(series.poster.height).toBeGreaterThan(300);
  expect(series.synopsis.width).toBeGreaterThan(800);

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1');
  const season = await expectCoverBesideTitleBlock(page);
  // The breadcrumb is the title block's first element.
  const crumb = (await page.getByTestId('detail-breadcrumb').boundingBox())!;
  expect(Math.abs(season.poster.y - crumb.y)).toBeLessThanOrEqual(1);
});

test('detail page: an episode page has no cover and its text takes the wide width', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toContainText('Folge');
  await expect(page.getByTestId('detail-poster')).toHaveCount(0);
  const head = (await page.locator('.detail-head').boundingBox())!;
  const body = (await page.locator('.detail-body').boundingBox())!;
  expect(Math.round(head.x)).toBe(100);
  expect(Math.round(body.x)).toBe(100);
  expect(body.width).toBeGreaterThan(1300);
  expect(body.y).toBeGreaterThanOrEqual(head.y + head.height + 16 - 1);
  const synopsis = (await page.getByTestId('detail-synopsis').boundingBox())!;
  expect(Math.round(synopsis.x)).toBe(100);
});

test('detail page: the poster fades with the text column once the focus has left the hero', async ({
  page,
}) => {
  await openMovieDetail(page, { width: 1920, height: 1080 });
  const opacity = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity);
  expect(await opacity('.detail-poster')).toBe('1');
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await expect.poll(() => opacity('.detail-poster')).toBe('0');
  await expect.poll(() => opacity('.detail-text')).toBe('0');
});

test('detail page: many chips and badges wrap inside the text column', async ({ page }) => {
  await page.route('**/api/v2/catalog/items/m2*', async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    item.content_rating = 'UNRATED EXTENDED DIRECTORS CUT EDITION';
    await route.fulfill({ response, json: item });
  });
  await openMovieDetail(page, { width: 1920, height: 1080 });
  await expect(page.locator('.detail-chip')).toHaveCount(3);
  const column = (await page.locator('.detail-head').boundingBox())!;
  const boxes = await page
    .locator('.detail-chip, .detail-badge')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.right]));
  expect(boxes).toHaveLength(6);
  // More than one line of chips, and none reaches out of the column.
  expect(new Set(boxes.map(([top]) => Math.round(top!))).size).toBeGreaterThan(1);
  for (const [, right] of boxes) expect(right!).toBeLessThanOrEqual(column.x + column.width + 1);
});

test('detail page: a tall hero holds its content, the page scrolls smoothly to measured tops and the hero fades', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  await expect(page.getByTestId('detail-logo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeVisible();
  await expect(page.getByTestId('detail-credits')).toBeVisible();
  const box = (selector: string) => page.locator(selector).first().boundingBox();
  const opacity = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity);
  const pageOffset = () =>
    page.locator('.detail-page').evaluate((el) => {
      const w = el.ownerDocument.defaultView!;
      return new w.DOMMatrix(w.getComputedStyle(el).transform).f;
    });

  // (a) On the hero the action pills end at least 40 px above the seasons row, and the hero is
  // taller than its 760 px minimum, so an absolutely placed column would have overflowed it.
  const seasonCard = page.getByRole('button', { name: /Staffel 1/ });
  const seasonsHead = page.getByTestId('seasons-head');
  const actions = (await box('.detail-actions'))!;
  const seasonsOnHero = (await seasonsHead.boundingBox())!;
  expect(actions.y + actions.height + 40).toBeLessThanOrEqual(seasonsOnHero.y);
  expect((await box('.detail-hero'))!.height).toBeGreaterThan(760);
  expect(await opacity('.detail-text')).toBe('1');

  // (e) The page scrolls over 400 ms, not the 150 ms of a focus effect.
  expect(
    await page
      .locator('.detail-page')
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).transitionDuration),
  ).toBe('0.4s');

  // The layers that animate over the 4K backdrop stay on permanent compositor layers, or each
  // transition start or end re-rasters the backdrop on the TV.
  const willChange = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).willChange);
  for (const selector of ['.detail-text', '[data-zone]', '.detail-dim', '.detail-backdrop-layer']) {
    expect(await willChange(selector), selector).toContain('opacity');
  }
  expect(await willChange('.detail-page')).toContain('transform');

  // (b) Down to the seasons: their heading ends on the top safe line, and the hero text is gone.
  await page.keyboard.press('ArrowDown');
  await expect(seasonCard).toBeFocused();
  await expect
    .poll(async () => Math.abs((await seasonsHead.boundingBox())!.y - 54))
    .toBeLessThanOrEqual(2);
  await expect.poll(() => opacity('.detail-text')).toBe('0');
  // The dim over the backdrop is at least 0.85 black once the focus has left the hero.
  await expect
    .poll(() =>
      page
        .getByTestId('detail-dim')
        .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity),
    )
    .toBe('1');
  expect(
    await page
      .getByTestId('detail-dim')
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0.85)');

  // (c) Along the row: the block stays where it is, the hero stays faded.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Staffel 2/ })).toBeFocused();
  expect(Math.abs((await seasonsHead.boundingBox())!.y - 54)).toBeLessThanOrEqual(2);
  expect(await opacity('.detail-text')).toBe('0');

  // (d) Up to the action pills: the hero text is back and the page is at its origin.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await expect.poll(() => opacity('.detail-text')).toBe('1');
  await expect.poll(pageOffset).toBe(0);
});

test('detail page: spoiler protection blurs an unwatched episode without requesting its still, a watched one shows it', async ({
  page,
}) => {
  const { seen } = await openSeriesDetail(page, false, 1, undefined, true);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();

  const first = page.getByRole('button', { name: /Episode 1.1/ });
  const second = page.getByRole('button', { name: /Episode 1.2/ });
  // The unwatched episode: its decoded preview, the notice instead of the description.
  await expect(first.getByTestId('art-protected')).toBeVisible();
  await expect(first.getByTestId('episode-synopsis-hidden')).toHaveText(
    'Beschreibung ausgeblendet',
  );
  await expect(first.getByTestId('episode-synopsis')).toHaveCount(0);
  // The watched one shows its still and its description.
  await expect(second.locator('img[src$="/img/still-12.png"]')).toBeVisible();
  await expect(second.getByTestId('episode-synopsis')).toHaveText('Synopsis of 1.2.');
  // The server saw a request for the watched still and never one for the unwatched still.
  expect(seen.some((entry) => entry.path === '/img/still-12.png')).toBe(true);
  expect(seen.some((entry) => entry.path === '/img/still-11.png')).toBe(false);
});

test('detail page: the profile setting ui.title_art decides between the logo and the text title', async ({
  page,
}) => {
  // Off: the text title, and the logo image is never requested.
  const off = await openSeriesDetail(page, true, undefined, false);
  await expect(page.getByTestId('detail-title')).toBeVisible();
  await expect(page.getByTestId('detail-logo')).toHaveCount(0);
  expect(off.seen.some((entry) => entry.path === '/img/logo.png')).toBe(false);
  // The settings reads carried the profile and asked for the keys one by one.
  const read = off.seen.find((entry) => entry.path === '/api/v2/settings/values/effective');
  expect(read?.profileId).toBe('profile-1');
  expect(read?.search).toContain('keys=ui.title_art&keys=');

  // On: the logo, and no text title.
  await openSeriesDetail(page, true, undefined, true);
  await expect(page.getByTestId('detail-logo')).toBeVisible();
  await expect(page.getByTestId('detail-title')).toHaveCount(0);
});

test('detail page: a movie scrolls to the similar row, whose top meets the safe line, and the cast row fades', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByTestId('row-cast')).toBeVisible();
  await expect(page.getByTestId('row-similar')).toBeVisible();

  const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.y;
  const opacity = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity);

  // Down from the action pills to the cast row, then to the similar row.
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await top('row-cast')) - 54)).toBeLessThanOrEqual(2);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Similar 1/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await top('row-similar')) - 54)).toBeLessThanOrEqual(2);
  await expect.poll(() => opacity('[data-zone="cast"]')).toBe('0');
  await expect.poll(() => opacity('.detail-text')).toBe('0');
  expect(await opacity('[data-zone="similar"]')).toBe('1');
});

test('detail page: Extras (one row per kind) play a local extra from its start and Trailer & mehr lists the YouTube videos; Back returns to the same card, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ extras: true });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  // "Extras": the local extras, one row per kind in the server's order (a caption, else the kind).
  const extras = page.getByTestId('detail-extras');
  await expect(extras.getByRole('heading', { name: 'Extras', exact: true })).toBeVisible();
  await expect(extras.locator('.row-title')).toHaveText(['Trailer', 'Featurettes']);
  await expect(extras.getByTestId('extra-title')).toHaveText(['Official Trailer', 'Featurette']);
  await expect(extras.getByTestId('extra-runtime')).toHaveText(['2:05', '10:00']);
  // "Trailer & mehr": the YouTube video, its kind and the Official badge.
  const trailers = page.getByTestId('row-trailers');
  await expect(trailers.getByRole('heading', { name: 'Trailer & mehr' })).toBeVisible();
  await expect(trailers.getByTestId('extra-title')).toHaveText(['The Teaser']);
  await expect(trailers.getByTestId('extra-kind')).toHaveText(['Teaser']);
  await expect(trailers.getByTestId('extra-official')).toHaveText(['Offiziell']);

  // Down from Play through the three rows and back; OK on the first card plays the extra.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Official Trailer/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Featurette/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /The Teaser/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /Official Trailer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  // The playback is the extra's own, from the beginning (no resume prompt, position 0).
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/playback/start')).toBe(true);
  expect(seen.some((e) => e.path === '/api/v2/watch/local-x1')).toBe(true);
  const start = JSON.parse(seen.find((e) => e.path === '/api/v2/playback/start')!.body) as {
    file_id: string;
    start_position: number;
  };
  expect(start.file_id).toBe('file-local-x1');
  expect(start.start_position).toBe(0);

  // Back: the detail page with the same extra focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByRole('button', { name: /Official Trailer/ })).toBeFocused();
  // Nothing was ever requested from YouTube or Google.
  expect(
    requested.filter((url) => /youtube|youtu\.be|ytimg|google|gstatic|ggpht/i.test(url)),
  ).toEqual([]);
});

test('detail page: Cast & Crew leads with the director, a rotated label stands before the writers and the cast, and Back returns to the writer, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  const strip = page.getByTestId('row-cast');
  await expect(strip.getByRole('heading', { name: 'Besetzung & Crew' })).toBeVisible();
  await expect(strip.getByTestId('card-title')).toHaveText([
    'Dana Director',
    'Wen Writer',
    'Ann Actor',
    'Bo Actor',
    'Cy Actor',
    'Di Actor',
  ]);
  await expect(strip.getByTestId('card-sub')).toHaveText([
    'Regie',
    'Drehbuch',
    'Role 0',
    'Role 1',
    'Role 2',
    'Role 3',
  ]);
  // The labels stand in the gap before the writers and before the cast, rotated, 20 px or more.
  const dividers = strip.getByTestId('credit-divider');
  await expect(dividers).toHaveCount(2);
  await expect(dividers.locator('.credit-divider-label')).toHaveText(['Drehbuch', 'Besetzung']);
  const label = dividers.locator('.credit-divider-label').first();
  expect(
    await label.evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).writingMode),
  ).toBe('vertical-rl');
  expect(
    await label.evaluate((el) =>
      parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).fontSize),
    ),
  ).toBeGreaterThanOrEqual(20);
  const writer = (await page.getByRole('button', { name: /Wen Writer/ }).boundingBox())!;
  const director = (await page.getByRole('button', { name: /Dana Director/ }).boundingBox())!;
  const gap = (await label.boundingBox())!;
  expect(gap.x).toBeGreaterThan(director.x + director.width);
  expect(gap.x + gap.width).toBeLessThan(writer.x);

  // Down to the director, Right across the "Drehbuch" label to the writer, OK opens the page.
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Wen Writer/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('person-name')).toHaveText('Wen Writer');

  // Back: the detail page with the same card focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByRole('button', { name: /Wen Writer/ })).toBeFocused();
});

test('detail page: a season shows Besetzung and the Crew box; a name opens the person page, and Back returns to the same name, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true, seasonCredits: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  // Down to the seasons row, OK on the first season opens its page.
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toContainText('Staffel 1');
  await expect(page.getByTestId('episode-grid')).toBeVisible();

  // Besetzung: the cast only. Crew: a box with a row per job; Screenplay is no writer here.
  await expect(
    page.getByTestId('row-cast').getByRole('heading', { name: 'Besetzung' }),
  ).toBeVisible();
  await expect(page.getByTestId('row-cast').getByTestId('card-title')).toHaveText([
    'Ann Actor',
    'Bo Actor',
  ]);
  const box = page.getByTestId('crew-box');
  await expect(page.getByRole('heading', { name: 'Crew', exact: true })).toBeVisible();
  await expect(box.locator('.crew-label')).toHaveText(['Regie', 'Drehbuch', 'Produktion']);
  await expect(page.getByTestId('crew-row-writer').getByTestId('crew-name')).toHaveText([
    'Wen Writer',
  ]);
  await expect(box.getByText('Sam Screen')).toHaveCount(0);
  await expect(page.getByTestId('crew-row-producer').getByTestId('crew-name')).toHaveText([
    'Pia Producer',
    'Pat Producer',
  ]);
  // A name is a target of at least 75 px.
  const name = (await page.getByRole('button', { name: 'Pia Producer' }).boundingBox())!;
  expect(name.height).toBeGreaterThanOrEqual(75);

  // Down into the grid and past it to Besetzung, then to the Crew box and down to the producers.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Dana Director' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Wen Writer' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Pia Producer' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Pat Producer' })).toBeFocused();
  // The focused name is a light fill with dark text, as every focused button.
  expect(
    await page
      .getByRole('button', { name: 'Pat Producer' })
      .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  // OK opens the person page.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('person-name')).toHaveText(/./);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-breadcrumb')).toContainText('Staffel 1');
  await expect(page.getByRole('button', { name: 'Pat Producer' })).toBeFocused();
});

test('detail page: Down from the last row of a scrolling episode grid lands on Besetzung, Up from it on the grid card it left', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true, seasonCredits: true, episodeCount: 12 });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('episode-grid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erste Folge abspielen' })).toBeFocused();

  // Down into the grid and through its three rows (the grid scrolls inside its viewport).
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1\.1(?!\d)/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1\.6(?!\d)/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1\.11(?!\d)/ })).toBeFocused();
  // Down again: the next block is Besetzung, not the Crew box.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  // Up: the grid, on the card it was left from, not the Play button.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /Episode 1\.11(?!\d)/ })).toBeFocused();
});

test('detail page: a series scrolls to Extras and Trailer & mehr between its seasons and its cast', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true, extras: true, tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
  await expect(page.getByTestId('season-rail')).toBeVisible();
  // Down: the seasons, then the first row of extras.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Official Trailer/ })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await top('[data-testid="detail-extras"]')) - 54))
    .toBeLessThanOrEqual(2);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /The Teaser/ })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await top('[data-testid="row-trailers"]')) - 54))
    .toBeLessThanOrEqual(2);
  // The cast and crew of a series are one strip: its first card is the creator, the cast follows.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Vince Creator/ })).toBeFocused();
  await expect(page.getByTestId('row-cast').getByTestId('card-sub').first()).toHaveText('Idee');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
});

test('detail page: a cast card opens the person page; Movies, a title, and Back return to the same card and filter, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  // Down to the strip (director, writer, then the cast), Right to the second actor, OK opens the
  // page; the name is there at once.
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Bo Actor/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('person-name')).toHaveText('Bo Actor');
  await expect(page.getByTestId('person-facts')).toContainText('Geboren am 25. April 1940');
  await expect(page.getByTestId('person-bio')).toHaveText('An actor from the fake server.');

  // The pills hold All, Movies and Series; All is selected and has the focus, its count shows.
  await expect(page.getByRole('tab')).toHaveText(['Alle', 'Filme', 'Serien']);
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('person-count')).toHaveText('3 Titel');
  await expect(page.getByTestId('card-title')).toHaveText([
    'First Title',
    'Second Title',
    'A Show',
  ]);
  expect(seen.some((e) => e.path === '/api/v2/catalog/people/p1' && e.search === '')).toBe(true);
  expect(seen.some((e) => e.path === '/api/v2/catalog' && e.search.includes('person_id=p1'))).toBe(
    true,
  );

  // Resting on Movies shows nothing; OK reads the movies.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Filme' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('card-title')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Filme' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('card-title')).toHaveText(['First Title', 'Second Title']);
  await expect(page.getByTestId('person-count')).toHaveText('2 Titel');

  // Down enters the grid: the page scrolls so the pills sit on the top safe line.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await page.getByTestId('person-pills').boundingBox())!.y - 54))
    .toBeLessThanOrEqual(2);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  // Back: the person page with Movies selected and the same card focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('person-name')).toHaveText('Bo Actor');
  await expect(page.getByRole('tab', { name: 'Filme' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('card-title')).toHaveText(['First Title', 'Second Title']);
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();

  // Back once more: the detail page with the same cast card focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByRole('button', { name: /Bo Actor/ })).toBeFocused();
});

test('detail page: a movie in a box set shows its row; Explore all opens the box set page, a film opens its page, and Back returns step by step, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ boxSet: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  // The row carries the box set's title; the film on screen is marked and the row ends with Explore all.
  const row = page.getByTestId('row-boxset');
  await expect(row).toBeVisible();
  await expect(row.getByRole('heading', { name: 'Saga Box Set' })).toBeVisible();
  await expect(row.getByTestId('card-title')).toHaveText([
    'Saga One',
    'Second Title',
    'Saga Three',
  ]);
  await expect(row.getByTestId('card-pill-start')).toHaveText('DIESER FILM');
  expect(
    seen.some(
      (e) => e.path === '/api/v2/catalog/items/m2/box-set' && e.search.includes('poster_width=352'),
    ),
  ).toBe(true);

  // Down from Play to the row, Right to Explore all (after the three films), OK opens the page.
  await page.keyboard.press('ArrowDown');
  await expect(row.getByRole('button', { name: /Saga One/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - 54)).toBeLessThanOrEqual(2);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(row.getByRole('button', { name: /Alle entdecken/ })).toBeFocused();
  await page.keyboard.press('Enter');

  // The box set page: the title at once, then the chip line and the label of a set in progress.
  await expect(page.getByTestId('boxset-title')).toHaveText('Saga Box Set');
  await expect(page.getByTestId('boxset-meta')).toHaveText(
    'BOX-SET · 3 Filme · 2001–2023 · 1 von 3 gesehen',
  );
  const play = page.getByRole('button', { name: 'Weiter · Second Title' });
  await expect(play).toBeFocused();
  expect(
    seen.some(
      (e) => e.path === '/api/v2/catalog/box-sets/bs1' && e.search.includes('library_id=lib-1'),
    ),
  ).toBe(true);

  // Down enters the grid; the films block scrolls to the safe line and the hero fades.
  const films = page.getByTestId('boxset-films');
  await page.keyboard.press('ArrowDown');
  await expect(films.getByRole('button', { name: /Saga One/ })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await films.getByRole('heading').boundingBox())!.y - 54))
    .toBeLessThanOrEqual(8);
  await expect
    .poll(() =>
      page
        .locator('.detail-text')
        .first()
        .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).opacity),
    )
    .toBe('0');
  await page.keyboard.press('ArrowRight');
  await expect(films.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');

  // Back: the box set page with the same film focused; Back again: the movie's page, Explore all focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('boxset-title')).toHaveText('Saga Box Set');
  await expect(films.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(
    page.getByTestId('row-boxset').getByRole('button', { name: /Alle entdecken/ }),
  ).toBeFocused();
});

test('person page: a 4,000-character biography opens in full; Down scrolls it to its last line, Back closes onto More', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ tall: true, longBio: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('person-name')).toHaveText('Ann Actor');

  // Up from the pills reaches More; OK opens the biography.
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('synopsis-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schließen' })).toBeFocused();

  // The dialog stays inside the safe area, the text is cut at the bottom, and the fade says so.
  const geometry = async () => {
    const box = (await page.getByTestId('synopsis-scroll').boundingBox())!;
    const text = (await page.getByTestId('synopsis-full').boundingBox())!;
    const dlg = (await dialog.boundingBox())!;
    return {
      boxBottom: box.y + box.height,
      textBottom: text.y + text.height,
      dlgTop: dlg.y,
      dlgBottom: dlg.y + dlg.height,
    };
  };
  const before = await geometry();
  expect(before.textBottom).toBeGreaterThan(before.boxBottom + 100);
  expect(before.dlgTop).toBeGreaterThanOrEqual(54 - 1);
  expect(before.dlgBottom).toBeLessThanOrEqual(1080 - 54 + 1);
  const scroll = page.getByTestId('synopsis-scroll');
  await expect(scroll).toHaveAttribute('data-more-below', 'true');
  await expect(scroll).toHaveAttribute('data-more-above', 'false');

  // Down moves the text; after enough presses the last line is inside the box.
  await page.keyboard.press('ArrowDown');
  await expect(scroll).toHaveAttribute('data-more-above', 'true');
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowDown');
  await expect(scroll).toHaveAttribute('data-more-below', 'false');
  await expect
    .poll(async () => {
      const g = await geometry();
      return g.textBottom <= g.boxBottom + 1;
    })
    .toBe(true);
  await expect(page.getByTestId('synopsis-full')).toContainText('THE END');
  // The focus never left Close.
  await expect(page.getByRole('button', { name: 'Schließen' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeFocused();
});

test('detail page: the synopsis dialog gives the focus back to More and keeps it past the navigation restore', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  const more = page.getByRole('button', { name: 'Mehr' });
  const dialog = page.getByTestId('synopsis-dialog');
  const reopen = async () => {
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schließen' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // The navigation moves the focus 300 ms after a dialog went; it must not take it from More.
    await page.waitForTimeout(400);
    await expect(more).toBeFocused();
  };
  await page.keyboard.press('ArrowUp');
  await expect(more).toBeFocused();
  await reopen();

  // The same on a season page: the title is the series', the synopsis the season's.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Staffel 1/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-breadcrumb')).toHaveText('A ShowStaffel 1');
  await expect(page.getByRole('button', { name: 'Erste Folge abspielen' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(more).toBeFocused();
  await reopen();
});

test('detail page: going up animates the transform and never scrolls the clipping box natively', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  const seasonCard = page.getByRole('button', { name: /Staffel 1/ });
  await page.keyboard.press('ArrowDown');
  await expect(seasonCard).toBeFocused();
  await expect
    .poll(async () => Math.round((await page.getByTestId('seasons-head').boundingBox())!.y))
    .toBe(54);

  // Capture phase on the window, so the record is taken before the page's own scroll handler
  // resets the box. A sampler records the page transform on every frame.
  await page.evaluate(`
    window.__scrolls = [];
    window.__offsets = [];
    window.addEventListener('scroll', (e) => {
      if (e.target.classList && e.target.classList.contains('detail')) {
        window.__scrolls.push(e.target.scrollTop);
      }
    }, true);
    const pageEl = document.querySelector('.detail-page');
    const sample = () => {
      window.__offsets.push(new DOMMatrix(getComputedStyle(pageEl).transform).f);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  `);
  const start = await page
    .locator('.detail-page')
    .evaluate(
      (el) =>
        new el.ownerDocument.defaultView!.DOMMatrix(
          el.ownerDocument.defaultView!.getComputedStyle(el).transform,
        ).f,
    );
  expect(start).toBeLessThan(-100);

  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await expect
    .poll(() =>
      page
        .locator('.detail-page')
        .evaluate((el) => el.ownerDocument.defaultView!.getComputedStyle(el).transform),
    )
    .toMatch(/^matrix\(1, 0, 0, 1, 0, -?0\)$|^none$/);

  const scrolls = (await page.evaluate('window.__scrolls')) as number[];
  const offsets = (await page.evaluate('window.__offsets')) as number[];
  // The box was never scrolled (a native scroll would have fired an event with a non-zero top).
  expect(scrolls.filter((top) => top !== 0)).toEqual([]);
  // The transform passed through values between the start and the origin: it animated.
  expect(offsets.some((f) => f < -1 && f > start + 1)).toBe(true);
});

test('detail page: with many seasons the focused card stays fully on screen at both ends', async ({
  page,
}) => {
  await openSeriesDetail(page, false, 12);
  await page.keyboard.press('ArrowDown');
  const first = page.locator('[data-focus-key="season:1"]');
  await expect(first).toBeFocused();
  for (let n = 2; n <= 12; n += 1) await page.keyboard.press('ArrowRight');
  const last = page.locator('[data-focus-key="season:12"]');
  await expect(last).toBeFocused();
  // Fully inside the screen (the focused poster is 5 % larger than its slot).
  await expect
    .poll(async () => {
      const box = (await last.locator('.card-art').boundingBox())!;
      return box.x >= 0 && box.x + box.width <= 1920;
    })
    .toBe(true);
  for (let n = 2; n <= 12; n += 1) await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();
  await expect
    .poll(async () => {
      const box = (await first.locator('.card-art').boundingBox())!;
      return box.x >= 0 && box.x + box.width <= 1920;
    })
    .toBe(true);
});

// Native focus scrolling is off (preventScroll); the navigation scrolls what really scrolls.
test('a long filter list scrolls so the focused genre is visible, Down and Up', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ seriesLibrary: true, genres: 40 });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByTestId('card-title').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Sortierung · Titel' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Action' })).toBeFocused();

  const inList = async (name: string) => {
    const item = page.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(item).toBeFocused();
    await expect
      .poll(async () => {
        const box = (await item.boundingBox())!;
        const list = (await page.locator('.lib-panel-list').boundingBox())!;
        return box.y >= list.y - 1 && box.y + box.height <= list.y + list.height + 1;
      })
      .toBe(true);
  };
  for (let i = 0; i < 41; i += 1) await page.keyboard.press('ArrowDown');
  await inList('Genre 40');
  expect(await page.locator('.lib-panel-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // The panel sits in a fixed backdrop; a step inside the visible part must not move the list.
  const listTop = () => page.locator('.lib-panel-list').evaluate((el) => el.scrollTop);
  const atEnd = await listTop();
  await page.keyboard.press('ArrowUp');
  await inList('Genre 39');
  expect(await listTop()).toBe(atEnd);
  await page.keyboard.press('ArrowDown');
  await inList('Genre 40');
  expect(await listTop()).toBe(atEnd);
  for (let i = 0; i < 41; i += 1) await page.keyboard.press('ArrowUp');
  await inList('Action');
  expect(await listTop()).toBe(0);
});

test('a screen taller than the window scrolls the document to the focused element', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ rewatch: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  // A window much shorter than the settings: moving the focus brings its pill into view.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: '7 s' })).toBeFocused();
  await page.setViewportSize({ width: 1920, height: 300 });
  const inWindow = () =>
    page.evaluate(
      `(() => { const box = document.activeElement.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; })()`,
    );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '10 s' })).toBeFocused();
  await expect.poll(inWindow).toBe(true);
  expect(await page.evaluate<number>('window.scrollY')).toBeGreaterThan(0);
  // Back at the top of the window the element is above the scrolled page: it scrolls up again.
  await page.evaluate('window.scrollTo(0, 0)');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: '7 s' })).toBeFocused();
  await expect.poll(inWindow).toBe(true);
});

test('Settings: scrolling back up shows the page title and the section headings above the focus, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ rewatch: true, subtitles: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const title = page.getByRole('heading', { level: 1, name: 'Einstellungen' });
  await expect(title).toBeVisible();
  const scrollY = () => page.evaluate<number>('window.scrollY');

  // Down through auto-play, the subtitle entry, language and clock to the last row (rewind).
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('settings-rewind').locator(':focus')).toHaveCount(1);
  expect(await scrollY()).toBeGreaterThan(0);

  // Up to the section's first row: its heading shows again.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('settings-language').locator(':focus')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Dieser Fernseher' })).toBeInViewport({
    ratio: 1,
  });

  // Up to the very first control: the page is back at the top, the title fully in view.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(
    page.getByTestId('settings-autoplay').getByRole('radio', { name: 'Aus' }),
  ).toBeFocused();
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(await scrollY()).toBe(0);
});

test('search: type with the on-screen keyboard, results with a box set, open a title and come back, clear again, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ boxSet: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });

  // The Search tab is the last one; Down lands on the keyboard, on "a".
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Suche', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-hint')).toContainText('Finde Filme, Serien und Personen');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('osk-a')).toBeFocused();

  // "sag" with the arrow keys: s is in the third row (o p q r s t u), fifth column.
  const press = async (key: string, times = 1) => {
    for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
  };
  await press('ArrowDown', 2);
  await press('ArrowRight', 4);
  await expect(page.getByTestId('osk-s')).toBeFocused();
  await page.keyboard.press('Enter');
  await press('ArrowUp', 2);
  await press('ArrowLeft', 4);
  await expect(page.getByTestId('osk-a')).toBeFocused();
  await page.keyboard.press('Enter');
  await press('ArrowRight', 6);
  await expect(page.getByTestId('osk-g')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-text')).toHaveText('sag');
  // Typing keeps the focus on the keyboard.
  await expect(page.getByTestId('osk-g')).toBeFocused();

  // One request after the pause: the box set row and the titles appear.
  await expect(page.getByTestId('row-search-boxsets')).toBeVisible();
  await expect(page.getByTestId('search-count')).toHaveText('2 Ergebnisse');
  await expect(page.getByTestId('grid-track').getByTestId('card-title')).toHaveText([
    'Saga One',
    'Saga Three',
  ]);
  expect(
    seen.filter((e) => e.path === '/api/v2/catalog' && e.search.includes('q=sag')),
  ).toHaveLength(1);

  // A short text starts at the left of the field, like the placeholder.
  const run = page.getByTestId('search-run');
  const fieldBox = (await page.getByTestId('search-field').boundingBox())!;
  const runBox = (await run.boundingBox())!;
  expect(runBox.x - fieldBox.x).toBeLessThan(40);
  await expect(run).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  // With the box set row, the people row and the segments all present, the count line and the top
  // of the first title row are on screen before the focus moves into the results.
  await expect(page.getByTestId('search-count')).toHaveText('2 Ergebnisse');
  await expect(page.getByTestId('row-search-people')).toBeVisible();
  const countBox = (await page.getByTestId('search-count').boundingBox())!;
  expect(countBox.y + countBox.height).toBeLessThan(1080 - 54);
  const firstTitle = (await page
    .getByTestId('grid-track')
    .getByRole('button', { name: /Saga One/ })
    .boundingBox())!;
  expect(firstTitle.y).toBeLessThan(1080 - 54);
  const peopleBox = (await page.getByTestId('row-search-people').boundingBox())!;
  expect(peopleBox.height).toBeLessThanOrEqual(280);
  // Right from the keyboard's edge: the box set first. Down to the titles; OK opens the second.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('row-search-boxsets').getByRole('button')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('row-search-people').getByRole('button')).toBeFocused();
  await expect(page.getByTestId('row-search-people')).toContainText('Personen');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Saga One/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Saga Three/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toBeVisible();

  // Back: the search is as it was, with the same card focused.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search-text')).toHaveText('sag');
  await expect(page.getByRole('button', { name: /Saga Three/ })).toBeFocused();

  // Left to the first column, then to the keyboard (the key last used); Delete three times: the
  // hint is back.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: /Saga One/ })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('osk-g')).toBeFocused();
  await press('ArrowDown', 6);
  await press('ArrowLeft');
  await expect(page.getByTestId('osk-delete')).toBeFocused();
  await press('Enter', 3);
  await expect(page.getByTestId('search-hint')).toBeVisible();
  await expect(page.getByTestId('search-field')).toContainText('Suchen');
});

test('search: a query wider than the field keeps its end and the caret in view', async ({
  page,
}) => {
  const { origin } = await startFakeSilo();
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  // "m" is in the second row, sixth column.
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('osk-m')).toBeFocused();
  for (let i = 0; i < 40; i += 1) await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-text')).toHaveText('m'.repeat(40));
  const field = page.getByTestId('search-field');
  const text = page.getByTestId('search-text');
  // The text is wider than the field and shifted left: the field's right edge shows its end.
  await expect
    .poll(async () => {
      const f = (await field.boundingBox())!;
      const t = (await text.boundingBox())!;
      return t.x < f.x && t.x + t.width <= f.x + f.width;
    })
    .toBe(true);
});

// The Magic Remote wheel presses Up and Down (one step per 100 px, at most one per 120 ms). The
// pointer is wherever it is; the wheel works on the window, not on an element.
const WHEEL_GAP_MS = 200;

test('Magic Remote wheel: on Home it moves the focus between the rows, down and up', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({});
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  // Home's first row is in; a Down before that has no row to enter (the skeleton takes no focus).
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();

  await page.mouse.wheel(0, 100);
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await page.waitForTimeout(WHEEL_GAP_MS);
  await page.mouse.wheel(0, -100);
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
});

test('Magic Remote wheel: a long biography dialog scrolls its text', async ({ page }) => {
  const { origin } = await startFakeSilo({ tall: true, longBio: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  // The pills row (this file has subtitles only) sits between the buttons and the strip.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Dana Director/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('person-name')).toHaveText('Ann Actor');
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeFocused();
  await page.keyboard.press('Enter');
  const scroll = page.getByTestId('synopsis-scroll');
  await expect(scroll).toHaveAttribute('data-more-below', 'true');
  await expect(scroll).toHaveAttribute('data-more-above', 'false');

  await page.mouse.wheel(0, 100);
  await expect(scroll).toHaveAttribute('data-more-above', 'true');
  await page.waitForTimeout(WHEEL_GAP_MS);
  await page.mouse.wheel(0, -100);
  await expect(scroll).toHaveAttribute('data-more-above', 'false');
  // The focus stayed on Close; the wheel only moved the text.
  await expect(page.getByRole('button', { name: 'Schließen' })).toBeFocused();
});

test('Magic Remote wheel: in a long filter list it moves the focus and the list follows', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ seriesLibrary: true, genres: 40, rewatch: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByTestId('card-title').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  // The facets come from the server: until Genre is the focused row, OK would press whatever the
  // panel focused while it loaded (Done), not open Genre.
  await expect(page.getByRole('button', { name: /^Genre/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Action' })).toBeFocused();
  for (let i = 0; i < 41; i += 1) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(130);
  }
  const item = page.getByRole('menuitemcheckbox', { name: 'Genre 40', exact: true });
  await expect(item).toBeFocused();
  await expect
    .poll(async () => {
      const box = (await item.boundingBox())!;
      const list = (await page.locator('.lib-panel-list').boundingBox())!;
      return box.y >= list.y - 1 && box.y + box.height <= list.y + list.height + 1;
    })
    .toBe(true);
  expect(await page.locator('.lib-panel-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('Magic Remote wheel: on the settings screen in a small window nothing scrolls natively', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ rewatch: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.setViewportSize({ width: 1920, height: 300 });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '10 s' })).toBeFocused();
  await page.evaluate('window.scrollTo(0, 0)');
  // The rewind row is the last one: Down has nowhere to go, so the wheel must not fall back to
  // scrolling the page by itself.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(WHEEL_GAP_MS);
  await page.mouse.wheel(0, 400);
  await expect(page.getByRole('radio', { name: '10 s' })).toBeFocused();
  expect(await page.evaluate<number>('window.scrollY')).toBe(0);
});

async function openSecondTitleDetail(page: Page, themeMusic: boolean) {
  const { origin, seen } = await startFakeSilo({ themeMusic });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  return { seen };
}

test('detail page: with theme music on, the grant is requested for the title theme and the page stays quiet when the audio fails', async ({
  page,
}) => {
  const { seen } = await openSecondTitleDetail(page, true);
  const grants = () =>
    seen.filter((entry) => entry.path === '/api/v2/catalog/items/42/themes/5/playback');
  await expect.poll(() => grants().length).toBeGreaterThanOrEqual(1);
  const grant = seen.find((entry) => entry.path.endsWith('/themes/5/playback'));
  expect(grant?.method).toBe('POST');
  expect(grant?.profileId).toBe('profile-1');
  expect(JSON.parse(grant?.body ?? '{}')).toHaveProperty('accepted_formats');
  // The audio file answers 404: the stream is retried once with a new grant, then it stays quiet.
  await expect
    .poll(() => seen.filter((entry) => entry.path === '/audio/theme-grant.mp3').length)
    .toBe(2);
  await page.waitForTimeout(500);
  expect(grants().length).toBe(2);
  expect(seen.filter((entry) => entry.path === '/audio/theme-grant.mp3')).toHaveLength(2);
  // No credential is appended to the grant's URL.
  expect(seen.every((entry) => !entry.search.includes('token='))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
});

test('detail page: with theme music off, no capability or grant request is made', async ({
  page,
}) => {
  const { seen } = await openSecondTitleDetail(page, false);
  await page.waitForTimeout(500);
  expect(seen.some((entry) => entry.path.includes('/themes/'))).toBe(false);
});

async function openSecondTitle(page: Page, origin: string) {
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
}

test('detail page: AI translation in auto mode shows the running state, then the translated text marked as AI', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ translation: 'auto' });
  await openSecondTitle(page, origin);
  // The run starts by itself; the first re-read comes a second after the request.
  await expect(page.getByTestId('detail-translation')).toHaveText('Wird übersetzt …');
  await expect(page.getByTestId('detail-synopsis')).toHaveText('Der übersetzte Text.', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('detail-translation')).toHaveText('Von KI übersetzt');
  const posts = seen.filter((e) => e.path === '/api/v2/catalog/items/m2/translate-description');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]!.body)).toEqual({ target_language: 'de' });
  await expect(page.getByRole('button', { name: 'Beschreibung übersetzen' })).toHaveCount(0);
});

test('detail page: AI translation in button mode is started with the remote from the pill, and the focus ends on Play', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ translation: 'button' });
  await openSecondTitle(page, origin);
  const translate = page.getByRole('button', { name: 'Beschreibung übersetzen' });
  await expect(translate).toBeVisible();
  const play = page.getByTestId('detail-primary');
  await expect(play).toBeFocused();
  expect(seen.some((e) => e.path.endsWith('/translate-description'))).toBe(false);
  // Play, watched, favourite, rating, More, Translate description.
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  await expect(translate).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(translate).toHaveCount(0);
  await expect(play).toBeFocused();
  await expect(page.getByTestId('detail-synopsis')).toHaveText('Der übersetzte Text.', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('detail-translation')).toHaveText('Von KI übersetzt');
  await expect(play).toBeFocused();
});

// The Magic Remote pointer moves the focus and nothing else: a hovered card at the edge of the
// screen is focused where it sits, the page and the strip stay put, and only the next key scrolls
// (user decision 2026-11-09, TV test: the page ran away under a cursor near the edge).
const transformOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => (el as { style: { transform: string } }).style.transform);

test('the Magic Remote pointer focuses a half-visible card at the right edge of a row without scrolling the strip or the page', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ longRow: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  // Home's first row is in; a Down before that has no row to enter (the skeleton takes no focus).
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const second = page.getByRole('button', { name: /Second Title/ });
  await expect(second).toBeFocused();
  const rows = '.home-rows-inner';
  expect(await transformOf(page, rows)).toBe('translateY(0px)');

  // The row's right edge: the card that starts on the screen and ends past it.
  const track = page.locator('[data-testid="row-continue_watching"] [data-testid="row-track"]');
  const before = await track.evaluate(
    (el) => (el as { style: { transform: string } }).style.transform,
  );
  const edgeKey = await page.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="row-continue_watching"] [data-focus-key]'));
    const hit = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return r.left < 1880 && r.right > 1920;
    });
    return hit ? hit.getAttribute('data-focus-key') : null;
  })()`);
  expect(edgeKey).not.toBeNull();
  const edge = page.locator(`[data-focus-key="${edgeKey}"]`);
  const box = (await edge.boundingBox())!;
  await page.mouse.move(Math.min(box.x + 60, 1910), box.y + box.height / 2);
  await expect(edge).toBeFocused();
  await page.waitForTimeout(700);
  expect(
    await track.evaluate((el) => (el as { style: { transform: string } }).style.transform),
  ).toBe(before);
  expect(await transformOf(page, rows)).toBe('translateY(0px)');

  // The next key moves on from the hovered card and shifts the strip as before.
  await page.keyboard.press('ArrowRight');
  await expect(edge).not.toBeFocused();
  await expect
    .poll(() => track.evaluate((el) => (el as { style: { transform: string } }).style.transform))
    .not.toBe(before);
});

test('the Magic Remote pointer over the Movies tab does not lift Home back to its carousel; keys still move the rows', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ longRow: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const second = page.getByRole('button', { name: /Second Title/ });
  await expect(second).toBeFocused();
  const stage = page.locator('.home-stage');
  await expect(stage).toHaveAttribute('data-rows', 'true');
  const stageTransform = () =>
    page.evaluate("getComputedStyle(document.querySelector('.home-stage')).transform");
  const rows = '.home-rows-inner';
  // Let the stage's own move settle before taking its position.
  await page.waitForTimeout(700);
  const lifted = await stageTransform();
  const rowsAt = await transformOf(page, rows);

  // The pointer over the Movies tab highlights it and moves nothing.
  const tab = page.getByRole('button', { name: 'Filme', exact: true });
  await tab.hover();
  await expect(tab).toBeFocused();
  await page.waitForTimeout(700);
  await expect(stage).toHaveAttribute('data-rows', 'true');
  expect(await stageTransform()).toBe(lifted);
  expect(await transformOf(page, rows)).toBe(rowsAt);

  // Back over a card, then a key: the rows move by keys as before.
  await second.hover();
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(second).not.toBeFocused();
  await expect(stage).toHaveAttribute('data-rows', 'true');
});

test('the Magic Remote pointer focuses a card of a lower block on the detail page without scrolling the page', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ tall: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByTestId('row-cast')).toBeVisible();
  const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.y;
  const castTop = await top('row-cast');

  // The cast row is on screen below the hero: the pointer focuses its card, the page stays.
  const card = (await page.getByRole('button', { name: /Ann Actor/ }).boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, Math.min(card.y + card.height / 2, 1070));
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  await page.waitForTimeout(700);
  expect(await top('row-cast')).toBe(castTop);

  // The next key scrolls: Down brings the similar row to the top safe-area line.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Similar 1/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await top('row-similar')) - 54)).toBeLessThanOrEqual(2);
});

test('rows do not wait for the home capabilities: Home and the Series tab show their rows while that request never answers', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({
    seriesLibrary: true,
    homeCapabilitiesNeverAnswer: true,
  });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 5000 });
  expect(seen.some((e) => e.path === '/api/v2/home/capabilities')).toBe(true);
  const sections = seen.find((e) => e.path === '/api/v2/home/sections');
  expect(sections?.search ?? '').not.toContain('item_limit');

  // Movies tab: its Recommended row shows although the capabilities are still pending.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich'], {
    timeout: 5000,
  });

  // Series tab: no skeleton is left waiting (the fake series library has no sections to show).
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-series')).toBeVisible();
  await expect(page.getByTestId('row-skeleton')).toHaveCount(0, { timeout: 5000 });
});

test('player controls: a key opens the overlay on the scrubber, Up reaches Exit, the gear menu opens and closes, Exit and Back leave, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const play = page.getByRole('button', { name: 'Ab Folge 1 starten' });
  await expect(play).toBeFocused();
  // The episodes tell Play what the watch state is; before that the player asks for itself.
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();

  const osd = page.getByTestId('player-osd');
  await expect(osd).toHaveAttribute('data-visible', 'false');
  // Before the first frame only Back works: a key changes nothing.
  await page.keyboard.press('ArrowUp');
  await expect(osd).toHaveAttribute('data-visible', 'false');
  // Media never plays in this test; the engine is told the first frame is there.
  await page.evaluate("document.querySelector('video').dispatchEvent(new Event('playing'))");
  // The player has taken the frame in (Play/Pause now offers Pause) before keys count.
  await expect(page.getByRole('button', { name: 'Pause', includeHidden: true })).toHaveCount(1);

  // The first key only opens the overlay, with the focus on the scrubber.
  await page.keyboard.press('ArrowUp');
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await expect(page.getByRole('slider', { name: 'Position' })).toBeFocused();
  // Up from the scrubber reaches Exit, top left; Down returns to the scrubber.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Beenden' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('slider', { name: 'Position' })).toBeFocused();
  // Down reaches the buttons on Play/Pause (showing what it does now: pause).
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '30 Sekunden vor' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: '10 Sekunden zurück' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('slider', { name: 'Position' })).toBeFocused();

  // Down to the row, Right to the settings gear (the fake plan offers a quality), Enter opens its
  // menu above the button with the checked quality focused; Down moves in it, Back closes it with
  // the focus on the gear, and the overlay stays.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Einstellungen' })).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByTestId('player-menu-settings');
  await expect(menu).toBeVisible();
  const auto = page.getByRole('menuitemradio', { name: 'Automatisch', exact: true });
  await expect(auto).toBeFocused();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: '1080p' })).toBeFocused();
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Einstellungen' })).toBeFocused();
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('player')).toBeVisible();

  // Back hides the overlay; Down with the overlay hidden only shows it again.
  await page.keyboard.press('Escape');
  await expect(osd).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('player')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await expect(page.getByRole('slider', { name: 'Position' })).toBeFocused();
  await expect(page.getByTestId('player-menu-settings')).toHaveCount(0);

  // Exit, reached with Up from the scrubber, leaves the player and stops the session.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Beenden' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toHaveCount(0);
  await expect(play).toBeVisible();
  // Leaving while the start is still in flight ends the session when its answer arrives, 2 s after
  // the video was unloaded (STOP_AFTER_UNLOAD_MS); the default 5 s is too tight on a slow machine.
  await expect
    .poll(
      () => seen.some((e) => e.method === 'DELETE' && e.path === '/api/v2/playback/e2e-session'),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Back with the overlay hidden leaves at once.
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await page.evaluate("document.querySelector('video').dispatchEvent(new Event('playing'))");
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('player')).toHaveCount(0);
});

test('player: OK with the overlay hidden and a click on the picture pause and resume', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ab Folge 1 starten' })).toBeFocused();
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  // No media plays here: the element is given a play state of its own, which the events follow.
  await page.evaluate(`(() => {
    const video = document.querySelector('video');
    let paused = false;
    Object.defineProperty(video, 'paused', { get: () => paused });
    video.play = () => {
      paused = false;
      video.dispatchEvent(new Event('play'));
      video.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    video.pause = () => {
      paused = true;
      video.dispatchEvent(new Event('pause'));
    };
    video.dispatchEvent(new Event('playing'));
  })()`);

  const osd = page.getByTestId('player-osd');
  await expect(page.getByRole('button', { name: 'Pause', includeHidden: true })).toHaveCount(1);
  await expect(osd).toHaveAttribute('data-visible', 'false');

  // OK with the overlay hidden pauses at once and shows the overlay on Play/Pause; OK again resumes.
  await page.keyboard.press('Enter');
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();

  // The pointer opens the overlay by moving; a click in the middle of the picture then pauses, and
  // another click resumes. The overlay stays up throughout.
  await page.mouse.move(960, 400);
  await page.mouse.move(970, 420);
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await page.mouse.click(960, 400);
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeVisible();
  await expect(osd).toHaveAttribute('data-visible', 'true');
  await page.mouse.click(960, 400);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(osd).toHaveAttribute('data-visible', 'true');
  // The bottom part of the overlay is no control either: its empty space is the picture.
  await page.mouse.click(960, 1050);
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeVisible();
});

test('player: Next episode stops the session, opens the next episode in its place, and Back leaves to where the first one was started, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ rewatch: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  // The rewatch card of Continue Watching plays at once.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-detail')).toContainText('EPISODE 1.1');
  await page.evaluate("document.querySelector('video').dispatchEvent(new Event('playing'))");
  await expect(page.getByRole('button', { name: 'Pause', includeHidden: true })).toHaveCount(1);
  // The first episode has no Previous (a spacer) and a Next once the season reads are in.
  await expect(
    page.getByRole('button', { name: 'Nächste Folge', includeHidden: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Vorherige Folge', includeHidden: true }),
  ).toHaveCount(0);

  // Up opens the overlay on the scrubber, Down moves to Pause, Right twice to Next episode.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('slider', { name: 'Position' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Nächste Folge' })).toBeFocused();
  await page.keyboard.press('Enter');

  // The old session was ended, a new one started, and the player names the next episode.
  await expect
    .poll(
      () => seen.filter((e) => e.method === 'POST' && e.path === '/api/v2/playback/start').length,
    )
    .toBe(2);
  await expect
    .poll(
      () => seen.some((e) => e.method === 'DELETE' && e.path === '/api/v2/playback/e2e-session'),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(seen.some((e) => e.path === '/api/v2/watch/e12')).toBe(true);
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-detail')).toContainText('EPISODE 1.2');
  // Back (before the first frame) leaves the player for Continue Watching, where it started.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('player')).toHaveCount(0);
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
});

test('player: repeated stalls ask to lower the quality, Lower sends a quality_change replan and the undo pill follows, keyboard only', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ series: true, buffering: 'ask' });
  // The stall rules run on real time (10 s grace); the clock is moved instead of waited for.
  await page.clock.install();
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const play = page.getByRole('button', { name: 'Ab Folge 1 starten' });
  await expect(play).toBeFocused();
  // The episodes tell Play what the watch state is; before that the player asks for itself.
  await expect(page.getByTestId('season-rail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();

  // Media never plays in this test: the first frame and the metadata are announced by hand, and
  // the element is told it is not paused (autoplay may be blocked in the test browser).
  await page.evaluate(`(() => {
    const video = document.querySelector('video');
    Object.defineProperty(video, 'paused', { value: false });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('playing'));
  })()`);
  await expect(page.getByRole('button', { name: 'Pause', includeHidden: true })).toHaveCount(1);
  // The startup grace is over; then two stalls of 1.5 s.
  await page.clock.fastForward(11_000);
  const stall = async () => {
    // Media data arrived just before: the link is not silent.
    await page.evaluate("document.querySelector('video').dispatchEvent(new Event('progress'))");
    await page.evaluate("document.querySelector('video').dispatchEvent(new Event('waiting'))");
    await page.clock.fastForward(1_500);
    await page.evaluate("document.querySelector('video').dispatchEvent(new Event('playing'))");
  };
  await stall();
  await page.clock.fastForward(1_000);
  await stall();

  const prompt = page.getByTestId('player-buffering');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Wiedergabe puffert immer wieder');
  const lower = page.getByTestId('player-buffering-lower');
  await expect(lower).toBeFocused();
  await expect(lower).toHaveText('Qualität senken');
  expect(seen.some((e) => e.path.endsWith('/replan'))).toBe(false);

  await page.keyboard.press('Enter');
  await expect.poll(() => seen.some((e) => e.path.endsWith('/replan'))).toBe(true);
  const replan = JSON.parse(seen.find((e) => e.path.endsWith('/replan'))!.body) as Record<
    string,
    unknown
  >;
  expect(replan).toMatchObject({
    operation: 'quality_change',
    quality_preference: 'auto',
    bandwidth_estimate_kbps: 7000,
  });
  await expect(page.getByTestId('player-buffering-restore')).toBeFocused();
  await expect(page.getByTestId('player-buffering-restore')).toHaveText(
    'Qualität wiederherstellen',
  );
});

test('detail page: Back from the More dialog returns the focus to More, from the resume dialog to Play', async ({
  page,
}) => {
  await page.route('**/api/v2/catalog/items/m2*', async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    item.user_state = {
      in_watchlist: false,
      is_favorite: false,
      not_interested: false,
      played: false,
    };
    await route.fulfill({ response, json: item });
  });
  const { origin } = await startFakeSilo({});
  await openSecondTitle(page, origin);
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  // Play, watched, favourite, rating, More.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  const more = page.getByRole('button', { name: 'Weitere Aktionen' });
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('more-menu')).toBeVisible();
  // The dialog has taken the focus; a viewer takes a moment before Back.
  await expect(page.getByTestId('more-menu').getByRole('button').first()).toBeFocused();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('more-menu')).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(more).toBeFocused();
  // The resume dialog (the movie is half way through) gives the focus back to Play.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('resume-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('resume-dialog')).toHaveCount(0);
  await expect(page.getByTestId('detail-primary')).toBeFocused();
});

test('detail page: the action row shows a selection effect on the primary button and the stars, and its colours', async ({
  page,
}) => {
  await page.route('**/api/v2/catalog/items/m2*', async (route) => {
    const response = await route.fetch();
    const item = await response.json();
    item.user_state = {
      in_watchlist: false,
      is_favorite: true,
      not_interested: false,
      played: false,
    };
    item.user_rating = 3;
    await route.fulfill({ response, json: item });
  });
  const { origin } = await startFakeSilo({});
  await openSecondTitle(page, origin);
  const primary = page.getByTestId('detail-primary');
  await expect(primary).toBeFocused();
  // LG's checklist wants a selection effect on every object: a ring and a slight growth.
  await expect(primary).toHaveCSS('transform', 'matrix(1.06, 0, 0, 1.06, 0, 0)');
  await expect(primary).toHaveCSS('box-shadow', /0px 0px 0px 4px/);
  // The played share inside the button, the red heart and the yellow stars.
  await expect(page.getByTestId('detail-play-fill')).toHaveCSS(
    'background-color',
    'rgba(20, 20, 23, 0.2)',
  );
  await expect(page.locator('.detail-heart[data-filled="true"]')).toHaveCSS(
    'color',
    'rgb(248, 113, 113)',
  );
  await expect(page.locator('.detail-star[data-filled="true"]').first()).toHaveCSS(
    'color',
    'rgb(250, 204, 21)',
  );
  // The stars take the same kind of effect when they have the focus.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  const stars = page.locator('.detail-stars');
  await expect(stars).toBeFocused();
  await expect(stars).toHaveCSS('transform', 'matrix(1.04, 0, 0, 1.04, 0, 0)');
  await expect(stars).toHaveCSS('box-shadow', /0px 0px 0px 4px/);
});

test('detail page: scrolled down a long episode grid, no row above the viewport shows at its top edge', async ({
  page,
}) => {
  await page.route('**/api/v2/catalog/series/s1/seasons/1/episodes*', async (route) => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      content_id: `e1${i + 1}`,
      season_number: 1,
      episode_number: i + 1,
      title: `Episode 1.${i + 1}`,
      runtime: 45,
      overview:
        'A synopsis that runs over the three lines of the caption and a bit further. '.repeat(3),
    }));
    await route.fulfill({ json: { items } });
  });
  await openSeriesDetail(page, false, 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.11/ })).toBeFocused();
  await page.waitForTimeout(800);
  const top = (await page.locator('.detail-episode-grid .grid-viewport').boundingBox())!.y;
  // A card that starts above the viewport's top edge and is not drawn invisible.
  const above = await page
    .locator('.card-episode')
    .evaluateAll(
      (els, edge) =>
        els.filter(
          (el) =>
            el.getBoundingClientRect().top < edge &&
            el.ownerDocument.defaultView!.getComputedStyle(el.parentElement!).opacity !== '0',
        ).length,
      top,
    );
  expect(top).toBeGreaterThan(0);
  expect(above).toBe(0);
});

test('detail page: the version, audio and subtitle pills with the remote, and the focus stays on the pill', async ({
  page,
}) => {
  const { origin, seen } = await startFakeSilo({ pills: true });
  await openSecondTitle(page, origin);
  const trackWrites = () =>
    seen.filter((entry) => entry.path.startsWith('/api/v2/audio-prefs/') && entry.method === 'PUT');
  // The sharpest file is the one the page describes: its runtime and its badges.
  await expect(page.locator('.detail-chip')).toHaveText(['2021', '1 Std. 35 Min.']);
  await expect(page.locator('.detail-badge')).toHaveText(['2160P', 'HDR', 'TrueHD']);

  // Down from the far right button of the row (More) and from Play: the pills row, on its first pill.
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-version')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-version')).toBeFocused();
  await expect(page.getByTestId('pill-version')).toContainText('2160p · HEVC · HDR · TrueHD');
  await expect(page.getByTestId('pill-audio')).toContainText('Automatisch: Deutsch · EAC3 · 5.1');
  await expect(page.getByTestId('pill-subtitles')).toContainText(
    'Automatisch: Deutsch (Erzwungen) · SRT',
  );

  // OK opens the list on the checked file; Down and OK pick the other one. The chips and the
  // badges follow it, and nothing is written to the server.
  await page.keyboard.press('Enter');
  const versions = page.getByTestId('pill-version-dialog');
  await expect(versions).toBeVisible();
  await expect(versions.getByRole('radio')).toHaveCount(2);
  await expect(versions.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(versions).toHaveCount(0);
  await expect(page.locator('.detail-chip')).toHaveText(['2021', '1 Std. 30 Min.']);
  await expect(page.locator('.detail-badge')).toHaveText(['1080P', 'EAC3']);
  await expect(page.getByTestId('pill-version')).toContainText('1080p · H264 · AAC');
  // The screen's focus restore runs after about 300 ms: the focus must still be on the pill.
  await page.waitForTimeout(400);
  await expect(page.getByTestId('pill-version')).toBeFocused();
  expect(trackWrites()).toHaveLength(0);

  // Right to Audio: Down twice to the second track, OK picks it and saves it for the title.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pill-audio')).toBeFocused();
  await page.keyboard.press('Enter');
  const audio = page.getByTestId('pill-audio-dialog');
  await expect(audio.getByRole('radio')).toHaveCount(3);
  await expect(audio.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(audio).toHaveCount(0);
  await expect(page.getByTestId('pill-audio')).toContainText('Englisch · AAC · Stereo');
  await expect.poll(() => trackWrites().length).toBe(1);
  expect(trackWrites()[0]!.path).toBe('/api/v2/audio-prefs/m2');
  expect(JSON.parse(trackWrites()[0]!.body)).toMatchObject({
    audio_track_index: 1,
    audio_language: 'en',
  });
  await page.waitForTimeout(400);
  await expect(page.getByTestId('pill-audio')).toBeFocused();

  // Back closes a list onto the same pill, and the focus stays there.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  await page.keyboard.press('Enter');
  const subtitles = page.getByTestId('pill-subtitles-dialog');
  await expect(subtitles.getByRole('radio', { name: /Second.Title.2021.WEB/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(subtitles).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('pill-subtitles')).toBeFocused();
  // Up leaves the pills for the buttons above them, from any pill.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
});

const pageOffset = (page: Page) =>
  page.locator('.detail-page').evaluate((el) => {
    const w = el.ownerDocument.defaultView!;
    return new w.DOMMatrix(w.getComputedStyle(el).transform).f;
  });

async function openLongMovie(page: Page, options: FakeOptions) {
  const { origin } = await startFakeSilo({ longMovie: true, titleArt: true, ...options });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const second = page.getByRole('button', { name: /Second Title/ }).first();
  await second.waitFor({ timeout: 10_000 });
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-logo')).toBeVisible();
  await expect(page.getByTestId('pill-subtitles')).toBeVisible();
  await expect(page.getByTestId('detail-primary')).toBeFocused();
}

/** The lines the synopsis draws and needs, and the bottom of the pills row in the window. */
async function heroFit(page: Page) {
  const synopsis = await page.getByTestId('detail-synopsis').evaluate((el) => {
    const lineHeight = parseFloat(el.ownerDocument.defaultView!.getComputedStyle(el).lineHeight);
    return {
      lines: Math.round(el.clientHeight / lineHeight),
      contentLines: Math.round(el.scrollHeight / lineHeight),
    };
  });
  const pills = (await page.locator('.detail-pills').boundingBox())!;
  return { ...synopsis, pillsBottom: pills.y + pills.height };
}

test('detail page: a long movie hero gives its synopsis lines up so the pills end in the safe area, and More opens the rest', async ({
  page,
}) => {
  await openLongMovie(page, {});
  // Many lines of text, six at the most on a movie: fewer are drawn, and the pills end above the
  // 5 % bottom safe line (1080 - 54 = 1026) with the page at its origin.
  const fit = await heroFit(page);
  expect(fit.contentLines).toBeGreaterThanOrEqual(9);
  expect(fit.lines).toBeGreaterThanOrEqual(2);
  expect(fit.lines).toBeLessThan(6);
  expect(fit.pillsBottom).toBeLessThanOrEqual(1026);
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeVisible();
  expect(await pageOffset(page)).toBe(0);

  // Down to the pills and Up again do not move the page.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-audio')).toBeFocused();
  await page.waitForTimeout(500);
  expect(await pageOffset(page)).toBe(0);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await page.waitForTimeout(500);
  expect(await pageOffset(page)).toBe(0);

  // What the lines cut is one OK away: Up to Mehr, and the dialog has the whole text.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Mehr' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('synopsis-full')).toContainText('THE END');
});

test('detail page: a long movie hero in a short window keeps two synopsis lines and scrolls the pills in, and back', async ({
  page,
}) => {
  // The pills no longer wrap at the hero's full width, so the window is short: even two synopsis
  // lines (the least) leave the hero ending below the bottom safe line (800 - 54 = 746).
  await page.setViewportSize({ width: 1920, height: 800 });
  await openLongMovie(page, { pills: true });
  const fit = await heroFit(page);
  expect(fit.lines).toBe(2);
  expect(fit.pillsBottom).toBeGreaterThan(746);
  expect(await pageOffset(page)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pill-version')).toBeFocused();
  await expect.poll(async () => (await heroFit(page)).pillsBottom).toBeLessThanOrEqual(746);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('detail-primary')).toBeFocused();
  await expect.poll(async () => (await heroFit(page)).pillsBottom).toBeGreaterThan(746);
});

test('detail page: a movie with a short synopsis shows all of it and no More', async ({ page }) => {
  const { origin } = await startFakeSilo({ pills: true, titleArt: true });
  await openSecondTitle(page, origin);
  await expect(page.getByTestId('detail-synopsis')).toHaveText(
    'The second title, half way through.',
  );
  await expect(page.getByRole('button', { name: 'Mehr' })).toHaveCount(0);
  const synopsis = (await page.getByTestId('detail-synopsis').boundingBox())!;
  expect(Math.round(synopsis.height)).toBe(36);
});

test('cards: a Home row card shows the profile badges top left and the watch state top right, 16 px round, 20 px text', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ badges: true, series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const first = page.getByRole('button', { name: /First Title/ }).first();
  await expect(first).toBeVisible({ timeout: 10_000 });

  // The default badges of the server: resolution, range and audio top left, the release bottom left.
  const badges = first.locator('.badge-stack-top-left .badge');
  await expect(badges).toHaveText([/1080p/i, 'DV', 'EAC3']);
  // The pill preset draws a monitor before the resolution and a speaker before the audio codec,
  // none before the Dolby Vision wordmark.
  await expect(badges.nth(0).locator('svg')).toHaveCount(1);
  await expect(badges.nth(1).locator('svg')).toHaveCount(0);
  await expect(badges.nth(2).locator('svg')).toHaveCount(1);
  await expect(first.locator('.badge-stack-bottom-left .badge')).toHaveText('BluRay');
  // They read as upper case, in at least 20 px.
  const look = await badges.first().evaluate((el) => {
    const style = el.ownerDocument.defaultView!.getComputedStyle(el);
    return { size: parseFloat(style.fontSize), transform: style.textTransform };
  });
  expect(look.size).toBeGreaterThanOrEqual(20);
  expect(look.transform).toBe('uppercase');

  // A watched title has the green check in the top-right corner, the badges are on the left.
  const art = (await first.locator('.card-art').boundingBox())!;
  const check = (await first.getByTestId('watch-status-done').boundingBox())!;
  expect(check.x + check.width).toBeGreaterThan(art.x + art.width - 16);
  expect(check.y).toBeLessThan(art.y + 16);
  expect(check.width).toBeGreaterThanOrEqual(40);
  const badge = (await badges.first().boundingBox())!;
  expect(badge.x).toBeLessThan(art.x + 16);
  expect(badge.x + badge.width).toBeLessThan(check.x);

  // The art's corners are 16 px round.
  await expect(first.locator('.card-art')).toHaveCSS('border-radius', '16px');
  // Each card's art has its own compositor layer, so a focus move does not re-raster the row.
  await expect(first.locator('.card-art')).toHaveCSS('will-change', 'transform');
  await expect(first.locator('.art')).toHaveCSS('border-radius', '16px');

  // A started series shows how many episodes it has left, and has no file data for badges.
  const show = page.getByRole('button', { name: /A Show/ }).first();
  await expect(show.getByTestId('watch-status-left')).toHaveText('3');
  await expect(show.locator('.card-badges')).toHaveCount(0);
});

test('cards: the library grid draws badges on its posters', async ({ page }) => {
  const { origin } = await startFakeSilo({ badges: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tab-movies')).toBeVisible();
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Empfohlen' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByTestId('card-title')).toHaveCount(6);
  const grid = page.getByTestId('browse').locator('.card-grid');
  await expect(grid.first().locator('.badge-stack-top-left .badge')).toHaveText('4K');
  await expect(grid.first().locator('.card-art')).toHaveCSS('border-radius', '16px');
  await expect(grid.first().locator('.card-art')).toHaveCSS('will-change', 'transform');
});

test('cards: the seasons of a started series show the check and the episodes left', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ series: true, posters: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('row-continue_watching')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('season-rail')).toBeVisible();
  const first = page.getByRole('button', { name: /Staffel 1/ });
  const second = page.getByRole('button', { name: /Staffel 2/ });
  await expect(first.getByTestId('watch-status-done')).toBeVisible();
  await expect(second.getByTestId('watch-status-left')).toHaveText('1');
  await expect(second.getByTestId('watch-status-done')).toHaveCount(0);
  await expect(first.locator('.card-art')).toHaveCSS('border-radius', '16px');
});

test('Home: the featured carousel turns every 8 s, stands still on its buttons, is paged from the indicator, and the hero shows the focused card in the rows, keyboard only', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { origin } = await startFakeSilo({ featured: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const carousel = page.getByTestId('hero-carousel');
  const slideNumber = page.getByTestId('hero-slide-number');
  await expect(carousel).toBeVisible({ timeout: 10_000 });

  // The featured section is the carousel, not a row; no kicker, the title as text, "01 -- 03".
  await expect(page.getByTestId('row-title')).toHaveText(['Weiterschauen', 'Kürzlich hinzugefügt']);
  await expect(slideNumber).toHaveText('01');
  await expect(page.getByTestId('hero-slide-count')).toHaveText('03');
  await expect(page.getByTestId('hero-title')).toHaveText('First Title');
  await expect(page.getByTestId('hero-synopsis')).toHaveText('First Title is on the carousel.');
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mehr Infos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Diashow pausieren' })).toBeVisible();

  // The hero is 66 % of the window (713 px at 1080 p) and the first row shows its title below it,
  // inside the safe area.
  const hero = await page.getByTestId('hero').boundingBox();
  expect(hero!.height).toBeCloseTo(712.8, 0);
  const rowTitle = await page.getByTestId('row-title').first().boundingBox();
  expect(rowTitle!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height - 1);
  expect(rowTitle!.y + rowTitle!.height).toBeLessThanOrEqual(1080 - 54);

  // Left alone, the carousel turns after 8 s.
  await expect(slideNumber).toHaveText('02', { timeout: 14_000 });
  await expect(page.getByTestId('hero-title')).toHaveText('Second Title');

  // Down from the tab bar lands on "Abspielen"; on the buttons the carousel stands still.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeFocused();
  await page.waitForTimeout(9000);
  await expect(slideNumber).toHaveText('02');

  // Right twice reaches the indicator; Right there pages to the next slide.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Mehr Infos' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Diashow pausieren' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(slideNumber).toHaveText('03');

  // Down enters the first row; the hero shows the focused card and the carousel is out of sight.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect(carousel).toHaveCSS('opacity', '0');
  // Out of sight it also paints and animates nothing: no slide pictures, no running rail, so it
  // keeps no compositor layer (the card over it would need one too).
  await expect(page.getByTestId('hero-slide').first()).toHaveCSS('visibility', 'hidden');
  await expect(page.getByTestId('hero-rail-fill')).toHaveCSS('animation-name', 'none');
  await expect(page.getByTestId('hero-card').getByTestId('hero-title')).toHaveText('Second Title');

  // Up returns to the indicator it left, and the carousel to the slide it showed.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Diashow pausieren' })).toBeFocused();
  await expect(carousel).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('hero-slide').first()).toHaveCSS('visibility', 'visible');
  await expect(page.getByTestId('hero-rail-fill')).toHaveCSS('animation-name', 'hero-rail');
  await expect(slideNumber).toHaveText('03');
  await expect(page.getByTestId('hero-title')).toHaveText('Third Title');

  // OK on the indicator pauses; its name follows.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Diashow abspielen' })).toBeFocused();
});

test('Movies: Recommended opens with the carousel under the pills, Down reaches its buttons and then the rows, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ featured: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused({
    timeout: 10_000,
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const carousel = page.getByTestId('hero-carousel');
  await expect(carousel).toBeVisible();
  await expect(page.getByTestId('hero-slide-number')).toHaveText('01');
  await expect(page.getByTestId('row-title')).toHaveText(['Empfohlen für dich']);

  // The hero starts at the top of the content, under the pills; the pills stay on top of it.
  const hero = await page.getByTestId('hero').boundingBox();
  expect(hero!.y).toBeCloseTo(141, 0);
  expect(hero!.height).toBeCloseTo(760, 0);
  const pill = page.getByRole('tab', { name: 'Empfohlen' });
  const box = await pill.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(hero!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(hero!.y + 200);
  const topmost = await page.evaluate(
    `document.elementFromPoint(${box!.x + box!.width / 2}, ${box!.y + box!.height / 2})?.closest('[role="tab"]')?.textContent ?? null`,
  );
  expect(topmost).toBe('Empfohlen');

  // Down from the pills reaches "Abspielen", Down again the first row, Up the button again.
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByTestId('library-screen').getByRole('tab', { name: 'Empfohlen' }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await expect(carousel).toHaveCSS('opacity', '0');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Abspielen' })).toBeFocused();
  await expect(carousel).toHaveCSS('opacity', '1');
});

test("Home: the carousel's picture is as bright as the web's, only the left third and the bottom are shaded", async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ featured: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hero-carousel')).toBeVisible({ timeout: 10_000 });
  const brightnessAt = async (x: number, y: number) => {
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
    return page.evaluate(
      `(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${png.toString('base64')}';
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return (r + g + b) / 3;
      })()`,
    ) as Promise<number>;
  };
  // The right half, above the copy: the picture (200) at 90 % brightness is 180; at least 85 % of it.
  await expect.poll(() => brightnessAt(1300, 400), { timeout: 10_000 }).toBeGreaterThanOrEqual(170);
  // The left third under the text is shaded.
  expect(await brightnessAt(100, 400)).toBeLessThan(100);
});

test('Home rows like the web: wide Continue Watching cards with three lines, the hero repeating them, posters with the year line and Explore all, keyboard only', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ rewatch: true, series: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ }).first()).toBeVisible({
    timeout: 10_000,
  });

  const sizeOf = (card: ReturnType<typeof page.locator>) =>
    card.evaluate((el) => ({
      width: el.clientWidth,
      art: el.querySelector('.card-art')!.clientHeight,
    }));

  // Down into Continue Watching, then Right to the episode: a 315x177 card with its three lines.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const episode = page.locator('.card-landscape:focus');
  await expect(episode).toBeFocused();
  expect(await sizeOf(episode)).toEqual({ width: 315, art: 177 });
  await expect(episode.getByTestId('card-title')).toHaveText('A Show');
  await expect(episode.getByTestId('card-episode')).toHaveText('Staffel 1 Folge 9 • Episode 1.9');
  await expect(episode.getByTestId('card-status')).toHaveText('Noch 35 Min.');
  // The hero repeats the lines once the focus has rested.
  await expect(page.getByTestId('hero-title')).toHaveText('A Show');
  await expect(page.getByTestId('hero-episode')).toHaveText('Staffel 1 Folge 9 • Episode 1.9');
  await expect(page.getByTestId('hero-status')).toHaveText('Noch 35 Min.');
  // The cards stand 335 px apart (315 + the web's 20 px gap).
  const lefts = await page
    .getByTestId('row-continue_watching')
    .locator('.row-slot')
    .evaluateAll((slots) => slots.map((slot) => slot.getBoundingClientRect().left));
  expect(lefts[1]! - lefts[0]!).toBe(335);

  // Down into Recently Added: 185x278 posters with the title and the year line; the hero follows
  // and drops the lines of the wide card.
  await page.keyboard.press('ArrowDown');
  const poster = page.locator('.card-poster:focus');
  await expect(poster).toBeFocused();
  expect(await sizeOf(poster)).toEqual({ width: 185, art: 278 });
  await expect(poster.getByTestId('card-title')).toBeVisible();
  await expect(poster.getByTestId('card-sub')).toHaveText(/^\d{4}( Serie)?$/);
  await expect(page.getByTestId('hero-title')).toHaveText(
    await poster.getByTestId('card-title').innerText(),
  );
  await expect(page.getByTestId('hero-episode')).toHaveCount(0);
  await expect(page.getByTestId('hero-status')).toHaveCount(0);

  // The row ends with the "Alle entdecken" card.
  // The series, the first and the third title come first.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Alle entdecken/ })).toBeFocused();
});

test('rows mode keeps the focused row inside the safe area: its last caption line ends at or above 1026 px, wide and poster rows on Home, a poster row on Movies', async ({
  page,
}) => {
  const { origin } = await startFakeSilo({ rewatch: true, series: true, featured: true });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hero-carousel')).toBeVisible({ timeout: 10_000 });
  // Where the focused card's caption ends, once the rows have settled under the focus.
  const captionEnd = async () => {
    await page.waitForTimeout(600);
    return page
      .locator('.card:focus .card-caption')
      .evaluate((el) => el.getBoundingClientRect().bottom);
  };

  // Down past the carousel's buttons into Continue Watching (wide), then into Recently Added.
  for (let i = 0; i < 2; i += 1) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.card-landscape:focus')).toBeFocused();
  expect(await captionEnd()).toBeLessThanOrEqual(1026);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.card-poster:focus')).toBeFocused();
  expect(await captionEnd()).toBeLessThanOrEqual(1026);

  // Movies: the Recommended view's first row.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('hero-slide-number')).toHaveText('01');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.card-poster:focus')).toBeFocused();
  expect(await captionEnd()).toBeLessThanOrEqual(1026);
});
