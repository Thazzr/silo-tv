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
}

interface FakeProfile {
  id: string;
  name: string;
  has_pin: boolean;
  is_primary: boolean;
  is_child: boolean;
}

const servers: Server[] = [];

async function startFakeSilo(options: FakeOptions = {}): Promise<{ origin: string; seen: Seen[] }> {
  const { name = 'E2E Silo', token = 'fake-access', code = true, password = false } = options;
  const withSeries = options.series === true;
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
              }
            : {
                ...baseItem,
                content_id: 's1',
                type: 'series',
                title: 'A Show',
                year: 2020,
                season_count: 2,
                overview: 'A show with two seasons.',
                play_content_id: 'e11',
                play_season_number: 1,
              },
        );
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/catalog/series/s1/seasons') {
        return send(200, {
          items: [1, 2].map((n) => ({
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
        return send(200, { items: [] });
      }
      const watch = /^\/api\/v2\/watch\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && watch) {
        return send(200, {
          content_id: watch[1],
          title: 'Played',
          type: 'movie',
          subtitles: [],
          versions: [{ file_id: `file-${watch[1]}` }],
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
          return send(200, { items: [{ id: 'lib-1', name: 'Movies', type: 'movies' }] });
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
                ],
                total_count: 1,
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
          return send(200, {
            items: [
              { content_id: 'm1', title: 'First Title', type: 'movie', year: 2019 },
              { content_id: 'm2', title: 'Second Title', type: 'movie', year: 2021 },
            ],
            total: 2,
            total_exact: true,
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
  // Resume starts the playback at that position without asking again.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-cue')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/playback/start')).toBe(true);
  const resumeStart = seen.find((e) => e.path === '/api/v2/playback/start');
  expect(JSON.parse(resumeStart?.body ?? '{}')).toMatchObject({ start_position: 1350 });

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
  const media = seen.find((entry) => entry.path === '/api/v2/stream/e2e-session');
  expect(media?.search).toBe('?st=x&token=fake-access');
  expect(seen.filter((entry) => entry.path === '/api/v2/auth/device/poll')).toHaveLength(2);

  // Shell, keyboard only: Back in a row moves the focus to the Home tab.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  // Right moves across the tabs; the content follows after a short delay.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Filme', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Serien', exact: true })).toBeFocused();
  await expect(page.getByTestId('tab-series')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Serien', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Für dich', exact: true })).toBeFocused();
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

  // Down to the pills, Right onto season 2: it shows after the focus has rested there.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Staffel 1' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Staffel 2' })).toBeFocused();
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
  const homes = seen.filter((e) => e.path === '/api/v2/home/sections');
  expect(homes[homes.length - 1]?.profileId).toBe('profile-3');
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
// its menu: "Switch server" is the second item.
async function openServerListFromShell(page: Page) {
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Profilmenü für/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profil wechseln' })).toBeFocused();
  // Profile at launch sits between Switch profile and Switch server.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Profil beim Start/ })).toBeFocused();
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
  const homesOfA = a.seen.filter((entry) => entry.path === '/api/v2/home/sections');
  expect(homesOfA[homesOfA.length - 1]?.authorization).toBe('Bearer token-a');
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
