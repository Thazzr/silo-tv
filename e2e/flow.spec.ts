import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { distIndexUrl } from './paths.ts';

// A fake Silo server on 127.0.0.1 with permissive CORS (like probe.spec.ts, a real server instead
// of page.route(): Playwright does not apply the response-side CORS check to routed requests).
// It speaks just enough of /api/v2 for the first flow: server check, device-code sign-in that is
// approved on the second poll, one profile without a PIN, one library with two titles, and the
// playback protocol up to a plan whose media never answers (the loading cue stays).

interface Seen {
  method: string;
  path: string;
  search: string;
  authorization: string | undefined;
  profileId: string | undefined;
}

const servers: Server[] = [];

async function startFakeSilo(): Promise<{ origin: string; seen: Seen[] }> {
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
    seen.push({
      method: req.method ?? '',
      path: url.pathname,
      search: url.search,
      authorization: req.headers.authorization,
      profileId: req.headers['x-profile-id'] as string | undefined,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Drain the request body so the connection stays clean.
    req.resume();
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/v2/system/info':
        return send(200, { api_major: 2, server_version: 'fake' });
      case 'GET /api/v2/auth/device/capability':
        return send(200, { state: 'available', allowed: true, cancel: true });
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
          tokens: {
            access_token: 'fake-access',
            refresh_token: 'fake-refresh',
            expires_in: 3600,
            user: { id: 'user-1', username: 'viewer', role: 'user' },
          },
        });
      case 'GET /api/v2/profiles':
        return send(200, {
          items: [{ id: 'profile-1', name: 'Alex', has_pin: false, is_primary: true }],
        });
      case 'GET /api/v2/theme/branding':
        return send(200, {
          server_name: 'E2E Silo',
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
      case 'GET /api/v2/watch/m2':
        return send(200, {
          content_id: 'm2',
          title: 'Second Title',
          type: 'movie',
          subtitles: [],
          versions: [{ file_id: 'file-2' }],
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
      case 'GET /api/v2/catalog':
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
  await expect(page.getByRole('button', { name: /First Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Movies');
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
  // The Home tab has the focus; Down enters the list, then Down, Enter opens the second title.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player')).toBeVisible();
  await expect(page.getByTestId('player-cue')).toBeVisible();
  await expect.poll(() => seen.some((e) => e.path === '/api/v2/playback/start')).toBe(true);

  // Back leaves the player: the session is stopped and the list has its focus on that title.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('title-list')).toBeVisible();
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeFocused();
  await expect
    .poll(() =>
      seen.some((e) => e.method === 'DELETE' && e.path === '/api/v2/playback/e2e-session'),
    )
    .toBe(true);

  // The authenticated calls carried the token and the profile.
  const catalog = seen.find((entry) => entry.path === '/api/v2/catalog');
  expect(catalog?.authorization).toBe('Bearer fake-access');
  expect(catalog?.profileId).toBe('profile-1');
  // Playback went through protocol v3 with the same credentials.
  const start = seen.find((entry) => entry.path === '/api/v2/playback/start');
  expect(start?.authorization).toBe('Bearer fake-access');
  expect(start?.profileId).toBe('profile-1');
  // A video element cannot set headers: the media request carries the token as a query parameter.
  const media = seen.find((entry) => entry.path === '/api/v2/stream/e2e-session');
  expect(media?.search).toBe('?st=x&token=fake-access');
  expect(seen.filter((entry) => entry.path === '/api/v2/auth/device/poll')).toHaveLength(2);

  // Shell, keyboard only: Back in the list moves the focus to the Home tab.
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
