import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A fake Silo server with realistic amounts of data for the scroll profiling harness: Home with a
// continue-watching row and eight poster rows of 20 cards, a Movies library whose Recommended view
// has the same rows and whose Browse grid holds 240 titles (paged, 40 at a time). It speaks only
// what browsing needs; playback is not part of it. Images are a tiny PNG with a short delay, so the
// pictures arrive after the cards, the way they do over a network.

export const BROWSE_TOTAL = 240;
const ROWS = 8;
const PER_ROW = 20;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const card = (id: string, i: number, landscape = false) => ({
  content_id: id,
  title: `Title ${id}`,
  type: 'movie',
  year: 1990 + (i % 35),
  overview: `Synopsis of ${id}. A story that is long enough to need a line or two on the hero.`,
  poster_url: `/img/poster-${id}.png`,
  backdrop_url: `/img/backdrop-${id}.png`,
  ...(landscape
    ? { position_seconds: 600 + i * 30, duration_seconds: 5400, item_source: 'in_progress' }
    : {}),
});

const section = (id: string, title: string, type: string, landscape = false) => ({
  id,
  section_type: type,
  title,
  featured: false,
  item_limit: PER_ROW,
  is_custom: false,
  customized: false,
  total_count: PER_ROW + 20,
  has_more: true,
  items: Array.from({ length: PER_ROW }, (_, i) => card(`${id}-${i}`, i, landscape)),
});

export const homeSections = () => [
  section('cw', 'Continue Watching', 'continue_watching', true),
  ...Array.from({ length: ROWS }, (_, r) => section(`row${r}`, `Row ${r + 1}`, 'recently_added')),
];

export async function startPerfServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    req.resume();
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname.startsWith('/img/')) {
        setTimeout(() => {
          res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
          res.end(PNG);
        }, 40);
        return;
      }
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /api/v2/system/info':
          return send(200, { api_major: 2, server_version: 'fake' });
        case 'GET /api/v2/auth/providers':
          return send(200, {
            items: [
              { id: 'local', display_name: 'Silo account', mode: 'credentials', default: true },
            ],
            password_login: false,
          });
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
          return send(200, {
            status: 'approved',
            opened: true,
            poll_after: 1,
            profile_id: '',
            profile_token: '',
            temporary: false,
            tokens: {
              access_token: 'perf-access',
              refresh_token: 'perf-refresh',
              expires_in: 3600,
              user: { id: 'user-1', username: 'viewer', role: 'user' },
            },
          });
        case 'GET /api/v2/profiles':
          return send(200, {
            items: [
              { id: 'profile-1', name: 'Alex', has_pin: false, is_primary: true, is_child: false },
            ],
          });
        case 'GET /api/v2/theme/branding':
          return send(200, {
            server_name: 'Perf Silo',
            login_subtitle: '',
            storage_available: false,
          });
        case 'GET /api/v2/user/libraries':
          return send(200, { items: [{ id: 'lib-1', name: 'Movies', type: 'movies' }] });
        case 'GET /api/v2/home/capabilities':
          return send(200, {
            state: 'available',
            allowed: true,
            revision: 'r',
            section_item_limit_max: 100,
            row_item_limit_max: 100,
          });
        case 'GET /api/v2/home/sections':
          return send(200, { sections: homeSections() });
        case 'GET /api/v2/library/lib-1/sections':
          return send(200, { sections: homeSections().slice(1) });
        case 'GET /api/v2/catalog/search/capabilities':
          return send(200, {
            allowed: true,
            revision: 'r',
            state: 'available',
            extended_query_rules: true,
          });
        case 'GET /api/v2/catalog/filters':
          return send(200, {
            genres: ['Action'],
            studios: [],
            networks: [],
            countries: [],
            original_languages: [],
            content_ratings: [],
            authors: [],
            narrators: [],
            series: [],
          });
        case 'POST /api/v2/catalog/letters':
          return send(200, { total: BROWSE_TOTAL, letters: [], runs: [] });
        case 'GET /api/v2/catalog': {
          const start = Number(url.searchParams.get('cursor') ?? '0');
          const limit = Number(url.searchParams.get('limit') ?? '40');
          const end = Math.min(BROWSE_TOTAL, start + limit);
          return send(200, {
            items: Array.from({ length: end - start }, (_, i) => card(`b${start + i}`, start + i)),
            total: BROWSE_TOTAL,
            total_exact: true,
            window_cursor: 'w',
            page: { has_more: end < BROWSE_TOTAL, next_cursor: String(end) },
          });
        }
        default:
          return send(404, { title: 'not found', status: 404 });
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
