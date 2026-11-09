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
// two seasons, and the playback protocol up to a plan whose media never answers (the loading cue
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
  /** Adds a watched episode that is being watched again (position 600 s of 2700 s) to Continue Watching. */
  rewatch?: boolean;
  /**
   * Tall detail pages: the series gets a logo, a long synopsis, ratings and a credit line (a hero
   * taller than 760 px), the movie gets a cast and a "More like this" row.
   */
  tall?: boolean;
  /** How many seasons the series has (2 when omitted). */
  seasons?: number;
}

interface FakeProfile {
  id: string;
  name: string;
  has_pin: boolean;
  is_primary: boolean;
  is_child: boolean;
}

const servers: Server[] = [];

// The titles of the Movies library, for the Browse view: the fake server sorts, filters by genre
// and by title prefix, and lists the letters the way Silo does.
interface FakeTitle {
  id: string;
  title: string;
  year: number;
  genre: string;
}
const MOVIES: FakeTitle[] = [
  { id: 'm1', title: 'First Title', year: 2019, genre: 'Drama' },
  { id: 'm2', title: 'Second Title', year: 2021, genre: 'Action' },
  { id: 'm3', title: 'Third Title', year: 2020, genre: 'Drama' },
  { id: 'm4', title: 'Fourth Title', year: 2018, genre: 'Action' },
  { id: 'm5', title: 'Seventh Title', year: 2017, genre: 'Action' },
  { id: 'm6', title: 'Alpha Title', year: 2015, genre: 'Drama' },
];

interface FakeRule {
  field: string;
  op: string;
  value: unknown;
}
type FakeGroup = { match: string; rules: FakeRule[] };

/** The titles that satisfy the genre rules of the groups (the only rule these flows send). */
function filterTitles(groups: FakeGroup[]): FakeTitle[] {
  return MOVIES.filter((movie) =>
    groups.every((group) =>
      group.rules.some((rule) => rule.field === 'genre' && rule.value === movie.genre),
    ),
  );
}

function browseTitles(params: URLSearchParams): FakeTitle[] {
  const groups = JSON.parse(params.get('groups') ?? '[]') as FakeGroup[];
  const prefix = (params.get('name_prefix') ?? '').toLowerCase();
  const sort = params.get('sort') ?? 'title';
  const field = sort.replace(/^-/, '') === 'year' ? 'year' : 'title';
  const direction = sort.startsWith('-') ? -1 : 1;
  return filterTitles(groups)
    .filter((movie) => movie.title.toLowerCase().startsWith(prefix))
    .sort((a, b) =>
      field === 'year' ? (a.year - b.year) * direction : a.title.localeCompare(b.title) * direction,
    );
}

const asCard = (movie: FakeTitle) => ({
  content_id: movie.id,
  title: movie.title,
  type: 'movie',
  year: movie.year,
});

async function startFakeSilo(options: FakeOptions = {}): Promise<{ origin: string; seen: Seen[] }> {
  const { name = 'E2E Silo', token = 'fake-access', code = true, password = false } = options;
  const withSeries = options.series === true;
  const withSeriesLibrary = options.seriesLibrary === true;
  const withRewatch = options.rewatch === true;
  const tall = options.tall === true;
  const seasonCount = options.seasons ?? 2;
  const profiles: FakeProfile[] = [
    ...(options.profiles ?? [
      { id: 'profile-1', name: 'Alex', has_pin: false, is_primary: true, is_child: false },
    ]),
  ];
  const seen: Seen[] = [];
  let polls = 0;
  const server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
          url.pathname === '/api/v2/playback/start'
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
      if (req.method === 'GET' && url.pathname === '/img/logo.png') {
        // A 1x1 transparent PNG; the logo box gives it its size.
        res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
        return res.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
      }
      const tallMovie = tall
        ? {
            cast: ['Ann Actor', 'Bo Actor', 'Cy Actor', 'Di Actor'].map((name, order) => ({
              person_id: `p${order}`,
              name,
              character: `Role ${order}`,
              order,
            })),
          }
        : {};
      const tallSeries = tall
        ? {
            logo_url: '/img/logo.png',
            overview:
              'A long synopsis that runs over four lines on the hero of the detail page: it tells of a school, its playground, a great many children and the one teacher who has to keep them all busy until the bell rings and the next lesson begins, which is exactly why it needs the full text under the button.',
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
                user_data: {
                  position_seconds: 1350,
                  duration_seconds: 5400,
                  played: false,
                  watched_count: 0,
                  unplayed_count: 1,
                  in_progress_count: 1,
                },
                ...tallMovie,
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
          })),
        });
      }
      const episodes = /^\/api\/v2\/catalog\/series\/s1\/seasons\/(\d+)\/episodes$/.exec(
        url.pathname,
      );
      if (req.method === 'GET' && episodes) {
        const season = Number(episodes[1]);
        return send(200, {
          items: [1, 2].map((n) => ({
            content_id: `e${season}${n}`,
            season_number: season,
            episode_number: n,
            title: `Episode ${season}.${n}`,
            runtime: 45,
            overview: `Synopsis of ${season}.${n}.`,
          })),
        });
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
      const watch = /^\/api\/v2\/watch\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && watch) {
        if (watch[1] === 'e9') {
          // The server counts a rewatch as played but keeps its position (the TV finding).
          return send(200, {
            content_id: 'e9',
            title: 'Episode 1.9',
            type: 'episode',
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
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/v2/system/info':
          return send(200, { api_major: 2, server_version: 'fake' });
        case 'GET /api/v2/auth/providers':
          return send(200, {
            items: [
              { id: 'local', display_name: 'Silo account', mode: 'credentials', default: true },
            ],
            password_login: password,
          });
        case 'POST /api/v2/auth/login':
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
              effective_recipe: {},
              source: { duration_seconds: 5400 },
              stream: { container: 'mp4', url: '/api/v2/stream/e2e-session?st=x' },
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
          return send(200, {
            state: 'available',
            allowed: true,
            revision: 'r',
            section_item_limit_max: 100,
            row_item_limit_max: 100,
          });
        case 'GET /api/v2/home/sections':
          return send(200, {
            sections: [
              {
                id: 'continue_watching',
                section_type: 'continue_watching',
                title: 'Weiterschauen',
                items: [
                  {
                    content_id: 'm2',
                    title: 'Second Title',
                    type: 'movie',
                    position_seconds: 1350,
                    duration_seconds: 5400,
                    item_source: 'in_progress',
                    overview: 'The second title, half way through.',
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
                ],
                total_count: withRewatch ? 2 : 1,
              },
              {
                id: 'recently_added',
                section_type: 'recently_added',
                title: 'Neu hinzugefügt',
                items: [
                  ...(withSeries
                    ? [{ content_id: 's1', title: 'A Show', type: 'series', year: 2020 }]
                    : []),
                  { content_id: 'm1', title: 'First Title', type: 'movie', year: 2019 },
                  { content_id: 'm3', title: 'Third Title', type: 'movie', year: 2020 },
                ],
                total_count: 40,
              },
            ],
          });
        case 'GET /api/v2/catalog':
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
            const items = browseTitles(url.searchParams).map(asCard);
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
              {
                id: 'rec',
                section_type: 'recently_added',
                title: 'Empfohlen für dich',
                featured: false,
                item_limit: 20,
                is_custom: false,
                customized: false,
                total_count: 2,
                items: MOVIES.slice(0, 2).map(asCard),
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
          });
        case 'GET /api/v2/catalog/filters':
          return send(200, {
            genres: ['Action', 'Drama'],
            studios: [],
            networks: [],
            countries: [],
            original_languages: [],
            content_ratings: [],
            authors: [],
            narrators: [],
            series: [],
          });
        case 'POST /api/v2/catalog/letters': {
          const body = JSON.parse(requestBody || '{}') as { groups?: FakeGroup[] };
          const letters = new Map<string, number>();
          for (const movie of filterTitles(body.groups ?? [])) {
            const letter = movie.title[0]!.toUpperCase();
            letters.set(letter, (letters.get(letter) ?? 0) + 1);
          }
          const sorted = [...letters.entries()].sort(([a], [b]) => a.localeCompare(b));
          return send(200, {
            total: MOVIES.length,
            letters: sorted.map(([letter, count], position) => ({ letter, count, position })),
            runs: sorted.map(([letter], position) => ({ letter, position })),
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
  await expect(page.getByTestId('row-title')).toHaveText(['Weiterschauen', 'Neu hinzugefügt']);
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
  await expect(page.getByRole('button', { name: /Alle ansehen/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('section-grid-title')).toHaveText('Neu hinzugefügt');
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
  await expect(page.getByRole('button', { name: /Alle ansehen/ })).toBeFocused();

  // Up to Continue Watching: OK on the movie opens its page (tapped, not held), which offers to
  // resume where the profile stopped.
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByTestId('detail-meta')).toHaveText('2021 · 1 Std. 30 Min.');
  await expect(page.getByRole('button', { name: 'Fortsetzen ab 22:30' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Von vorn' })).toBeVisible();
  // Resume starts the playback without asking again, at that position minus the default rewind
  // of 7 s.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-cue')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/playback/start')).toBe(true);
  const resumeStart = seen.find((e) => e.path === '/api/v2/playback/start');
  expect(JSON.parse(resumeStart?.body ?? '{}')).toMatchObject({ start_position: 1343 });

  // Back leaves the player: the session is stopped and the page has its focus on Resume again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await expect(page.getByRole('button', { name: 'Fortsetzen ab 22:30' })).toBeFocused();
  // Back again returns to Home, on the card that opened the page.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect
    .poll(() =>
      seen.some((e) => e.method === 'DELETE' && e.path === '/api/v2/playback/e2e-session'),
    )
    .toBe(true);

  // The authenticated calls carried the token and the profile.
  const home = seen.find((entry) => entry.path === '/api/v2/home/sections');
  expect(home?.authorization).toBe('Bearer fake-access');
  expect(home?.profileId).toBe('profile-1');
  // The rows were asked for at 20 cards and at widths that fit the cards.
  expect(home?.search).toContain('item_limit=20');
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
  // The row opens on the saved pill (7 s); the arrows only move the highlight, OK selects.
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

test('Home to a series, season 2, play an episode and Back to the same episode, keyboard only', async ({
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
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  // The server's play target (S1 E1) is on Play; the seasons come in order, season 1 selected.
  await expect(page.getByRole('button', { name: 'S1 · E1 abspielen' })).toBeFocused();
  await expect(page.getByRole('tab')).toHaveText(['Staffel 1', 'Staffel 2']);
  await expect(page.getByRole('tab', { name: 'Staffel 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('episode-title')).toHaveText([
    'E1 · Episode 1.1',
    'E2 · Episode 1.2',
  ]);

  // Down to the pills, Right onto season 2: it shows only on OK, not while the focus rests there.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Staffel 1' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Staffel 2' })).toBeFocused();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('episode-title').first()).toHaveText('E1 · Episode 1.1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('episode-title').first()).toHaveText('E1 · Episode 2.1');
  await expect(page.getByRole('tab', { name: 'Staffel 2' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Down into the episodes, Right to the second one, OK plays it.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 2.1/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Episode 2.2/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/watch/e22')).toBe(true);

  // Back: the page is on season 2 and the same episode has the focus.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-title')).toHaveText('A Show');
  await expect(page.getByRole('tab', { name: 'Staffel 2' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: /Episode 2.2/ })).toBeFocused();
  // Back once more is Home, on the series card.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.getByRole('button', { name: /A Show/ })).toBeFocused();
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
  await expect(page.getByRole('tab', { name: 'Stöbern' })).toBeFocused();
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

  // The alphabet rail: only F and S have titles now. Right from the last poster reaches it.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
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
  // OK: the titles under S, in the grid, with the focus on the first of them.
  await page.keyboard.press('Enter');
  await expect(posters).toHaveText(['Second Title', 'Seventh Title']);
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Springe zu S' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(seen.some((e) => e.path === '/api/v2/catalog' && e.search.includes('name_prefix=S'))).toBe(
    true,
  );

  // Open a title; Back returns to the same poster with the same sort, filter and letter.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('detail-title')).toHaveText('Second Title');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect(posters).toHaveText(['Second Title', 'Seventh Title']);
  await expect(page.getByTestId('filter-count')).toHaveText('1');

  // Back from the poster: the sub-view pills, then the tab bar.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Stöbern' })).toBeFocused();
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

test('player diagnostics (blue key): a two-column list of readable rows inside the screen', async ({
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
  await expect(page.getByRole('button', { name: 'S1 · E1 abspielen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();

  // Blue is key code 406 on the remote; Playwright has no key name for it.
  await page.evaluate(
    "document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406, bubbles: true }))",
  );
  const panel = page.getByTestId('player-diagnostics');
  await expect(panel).toBeVisible();

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
  expect(styles.display).not.toBe('grid');
  expect(styles.columns).not.toContain('280px');
  expect(styles.wordBreak).not.toBe('break-all');

  const rows = await panel.locator('.player-diag-row').evaluateAll((els) =>
    els.map((el) => {
      const dt = el.querySelector('dt')!.getBoundingClientRect();
      const dd = el.querySelector('dd')!.getBoundingClientRect();
      return {
        label: el.querySelector('dt')!.textContent ?? '',
        text: el.querySelector('dd')!.textContent ?? '',
        dtLeft: dt.left,
        dtTop: dt.top,
        ddLeft: dd.left,
        ddTop: dd.top,
        ddWidth: dd.width,
        ddHeight: dd.height,
      };
    }),
  );
  expect(rows).toHaveLength(12);
  const oneLine = rows[0]?.ddHeight ?? 0;
  for (const row of rows) {
    // Label and value sit side by side, in this order, and the value has room to read.
    expect(row.ddLeft, row.label).toBeGreaterThan(row.dtLeft + 100);
    expect(Math.abs(row.ddTop - row.dtTop), row.label).toBeLessThan(oneLine);
    expect(row.ddWidth, row.label).toBeGreaterThanOrEqual(200);
    // A short value never wraps: it is as high as the route value.
    if (row.text.length <= 20) expect(row.ddHeight, row.label).toBeLessThanOrEqual(oneLine + 1);
  }

  // The panel lies inside the screen (and its 5 % safe area).
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(viewport.width * 0.05 - 1);
  expect(box!.y).toBeGreaterThanOrEqual(viewport.height * 0.05 - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width * 0.95 + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height * 0.95 + 1);

  await page.screenshot({
    path: 'test-results/shots/overlay-fixed.png',
  });
});

async function openSeriesDetail(page: Page, tall = false, seasons?: number) {
  const { origin } = await startFakeSilo({ series: true, tall, seasons });
  await page.goto(`${distIndexUrl}?server=${origin}`);
  await expect(page.getByLabel('Serveradresse')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /A Show/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'S1 · E1 abspielen' })).toBeFocused();
}

test('detail page: focused pills have black content on white, the selected season keeps its style', async ({
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
  const play = page.getByRole('button', { name: 'S1 · E1 abspielen' });
  expect(await paint(play)).toEqual(white);

  // The focused season pill, which is also the selected one.
  await page.keyboard.press('ArrowDown');
  const season1 = page.getByRole('tab', { name: 'Staffel 1' });
  await expect(season1).toBeFocused();
  expect(await paint(season1)).toEqual(white);

  // Another season focused: it is white too, and the selected one is back to its resting style.
  await page.keyboard.press('ArrowRight');
  const season2 = page.getByRole('tab', { name: 'Staffel 2' });
  await expect(season2).toBeFocused();
  expect(await paint(season2)).toEqual(white);
  const rest = await paint(season1);
  expect(rest.color).not.toBe('rgb(0, 0, 0)');
  expect(rest.background).not.toBe('rgb(255, 255, 255)');
});

test('detail page: the backdrop stays, the page snaps to the season pills, the text column is narrow', async ({
  page,
}) => {
  await openSeriesDetail(page);
  const shots =
    'test-results/shots';
  const layer = page.getByTestId('detail-backdrop-layer');
  const before = await layer.boundingBox();
  expect(before).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });

  // The hero's text column ends at 1000 px at the latest.
  const column = await page.locator('.detail-text').boundingBox();
  expect(column!.x + column!.width).toBeLessThanOrEqual(1000);
  const synopsis = await page.getByTestId('detail-synopsis').boundingBox();
  expect(synopsis!.x + synopsis!.width).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: `${shots}/series-resume.png` });

  // Down to the season pills and into the episodes: the actions are out of view, and no pill
  // reaches into the top safe-area band (54 px).
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Staffel 1' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  // The page has scrolled (400 ms) when the season pills sit on the safe line.
  const seasonTab = page.getByRole('tab', { name: 'Staffel 1' });
  await expect.poll(async () => Math.round((await seasonTab.boundingBox())!.y)).toBe(54);
  const pills = await page
    .locator('.detail-actions .detail-pill')
    .evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => [r.top, r.bottom]),
    );
  expect(pills.length).toBeGreaterThan(0);
  for (const [top, bottom] of pills) {
    expect(bottom <= 0 || top >= 54).toBe(true);
  }
  const seasons = await seasonTab.boundingBox();
  expect(Math.abs(seasons!.y - 54)).toBeLessThanOrEqual(2);
  expect(await layer.boundingBox()).toEqual(before);
  await expect(page.getByTestId('detail-dim')).toHaveAttribute('data-scrolled', 'true');
  await page.screenshot({ path: `${shots}/series-episodes.png` });
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

  // (a) On the hero the action pills end at least 40 px above the season pills, and the hero is
  // taller than its 760 px minimum, so an absolutely placed column would have overflowed it.
  const seasonTab = page.getByRole('tab', { name: 'Staffel 1' });
  const actions = (await box('.detail-actions'))!;
  const seasonsOnHero = (await seasonTab.boundingBox())!;
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

  // (b) Down to the season pills: they end on the top safe line, and the hero text is gone.
  await page.keyboard.press('ArrowDown');
  await expect(seasonTab).toBeFocused();
  await expect
    .poll(async () => Math.abs((await seasonTab.boundingBox())!.y - 54))
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

  // (c) Down to the episodes: the block stays where it is, the hero stays faded.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  expect(Math.abs((await seasonTab.boundingBox())!.y - 54)).toBeLessThanOrEqual(2);
  expect(await opacity('.detail-text')).toBe('0');

  // (d) Up to the action pills: the hero text is back and the page is at its origin.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /fortsetzen|abspielen/ }).first()).toBeFocused();
  await expect.poll(() => opacity('.detail-text')).toBe('1');
  await expect.poll(pageOffset).toBe(0);
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
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Ann Actor/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await top('row-cast')) - 54)).toBeLessThanOrEqual(2);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Similar 1/ })).toBeFocused();
  await expect.poll(async () => Math.abs((await top('row-similar')) - 54)).toBeLessThanOrEqual(2);
  await expect.poll(() => opacity('[data-zone="cast"]')).toBe('0');
  await expect.poll(() => opacity('.detail-text')).toBe('0');
  expect(await opacity('[data-zone="similar"]')).toBe('1');
});

test('detail page: going up animates the transform and never scrolls the clipping box natively', async ({
  page,
}) => {
  await openSeriesDetail(page, true);
  const seasonTab = page.getByRole('tab', { name: 'Staffel 1' });
  await page.keyboard.press('ArrowDown');
  await expect(seasonTab).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Episode 1.1/ })).toBeFocused();
  await expect.poll(async () => Math.round((await seasonTab.boundingBox())!.y)).toBe(54);

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
  await expect(seasonTab).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: /fortsetzen|abspielen/ }).first()).toBeFocused();
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

test('detail page: with many seasons the focused pill stays fully on screen at both ends', async ({
  page,
}) => {
  await openSeriesDetail(page, false, 12);
  await page.keyboard.press('ArrowDown');
  const first = page.getByRole('tab', { name: 'Staffel 1', exact: true });
  await expect(first).toBeFocused();
  for (let n = 2; n <= 12; n += 1) await page.keyboard.press('ArrowRight');
  const last = page.getByRole('tab', { name: 'Staffel 12' });
  await expect(last).toBeFocused();
  // Fully inside the screen.
  await expect
    .poll(async () => {
      const box = (await last.boundingBox())!;
      return box.x >= 0 && box.x + box.width <= 1920;
    })
    .toBe(true);
  for (let n = 2; n <= 12; n += 1) await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();
  await expect
    .poll(async () => {
      const box = (await first.boundingBox())!;
      return box.x >= 0 && box.x + box.width <= 1920;
    })
    .toBe(true);
});
