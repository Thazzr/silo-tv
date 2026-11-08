import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { distIndexUrl } from './paths.ts';

// A fake Silo server on 127.0.0.1 with permissive CORS (like probe.spec.ts, a real server instead
// of page.route(): Playwright does not apply the response-side CORS check to routed requests).
// It speaks just enough of /api/v2 for the first flow: server check, device-code sign-in that is
// approved on the second poll, one profile without a PIN, and one library with two titles.

interface Seen {
  method: string;
  path: string;
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
      case 'GET /api/v2/user/libraries':
        return send(200, { items: [{ id: 'lib-1', name: 'Movies', type: 'movies' }] });
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

  // Approved on the second poll: the single profile is selected, the list shows.
  await expect(page.getByRole('button', { name: /First Title/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Second Title/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Movies');
  // The first title has the focus; Down, Enter selects the second and shows the note.
  await expect(page.getByRole('button', { name: /First Title/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('playback-note')).toContainText('Second Title');

  // The authenticated calls carried the token and the profile.
  const catalog = seen.find((entry) => entry.path === '/api/v2/catalog');
  expect(catalog?.authorization).toBe('Bearer fake-access');
  expect(catalog?.profileId).toBe('profile-1');
  expect(seen.filter((entry) => entry.path === '/api/v2/auth/device/poll')).toHaveLength(2);
});
