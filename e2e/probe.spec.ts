import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { probeUrl } from './paths.ts';

interface CheckResult {
  id: string;
  transport: string;
  outcome: string;
  status?: number;
}
interface Report {
  done: boolean;
  startedAt: string;
  server: { origin: string } | null;
  cors: CheckResult[] | null;
  corsVerdict: string | null;
  media: unknown[] | null;
  errors: string[];
}

async function finishedReport(page: Page): Promise<Report> {
  await page.waitForFunction('window.__SILO_PROBE__ && window.__SILO_PROBE__.done === true');
  return (await page.evaluate('JSON.parse(JSON.stringify(window.__SILO_PROBE__))')) as Report;
}

function outcomes(report: Report): Record<string, CheckResult> {
  return Object.fromEntries((report.cors ?? []).map((r) => [r.id, r]));
}

// These tests use a real local HTTP server instead of page.route(): Playwright fulfils routed
// requests without applying the response-side CORS check (a simple GET without
// Access-Control-Allow-Origin still resolves, and an OPTIONS answered 200 without CORS headers
// passes the preflight), so route() cannot reproduce a blocked request. A real server does.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'X-Silo-Device-Id, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const servers: Server[] = [];

// A Silo-like server: JSON 200 for GET, 401 for POST, OPTIONS answered 405. With cors it also
// sends the CORS headers and answers the preflight with 204.
async function startServer(cors: boolean): Promise<string> {
  const headers = cors ? CORS_HEADERS : {};
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(cors ? 204 : 405, headers);
      res.end();
      return;
    }
    res.writeHead(req.method === 'POST' ? 401 : 200, {
      ...headers,
      'Content-Type': 'application/json',
    });
    res.end('{"probe":true}');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
});

test('without CORS headers every direct and XHR check is blocked and the verdict is none', async ({
  page,
}) => {
  const origin = await startServer(false);
  await page.goto(`${probeUrl}&server=${origin}`);
  const report = await finishedReport(page);
  const byId = outcomes(report);

  // Chromium also enforces CORS on the response of a "simple" GET: the request is sent, but a
  // response without Access-Control-Allow-Origin makes fetch reject, so even direct-simple is
  // blocked. The three preflighted checks fail at the OPTIONS step (405, no CORS headers).
  for (const id of [
    'direct-simple',
    'direct-preflight-get',
    'direct-preflight-post',
    'xhr-preflight-get',
  ]) {
    expect(byId[id]?.outcome, id).toBe('blocked');
  }
  // Not on webOS: no Luna bridge, so the JS service cannot be used.
  for (const id of ['service-ping', 'service-get', 'service-post']) {
    expect(byId[id]?.outcome, id).toBe('unavailable');
  }
  expect(report.corsVerdict).toBe('none');
  expect(report.server).toEqual({ origin });
  expect(report.done).toBe(true);

  await expect(page.getByTestId('cors-verdict')).toContainText('Weder direkte Anfragen');
  await expect(page.getByTestId('cors-table').locator('tbody tr')).toHaveCount(7);
});

test('with full CORS headers the direct and XHR checks reach the server', async ({ page }) => {
  const origin = await startServer(true);
  await page.goto(`${probeUrl}&server=${origin}`);
  const report = await finishedReport(page);
  const byId = outcomes(report);

  expect(byId['direct-simple']).toMatchObject({ outcome: 'reached', status: 200 });
  expect(byId['direct-preflight-get']).toMatchObject({ outcome: 'reached', status: 200 });
  expect(byId['direct-preflight-post']).toMatchObject({ outcome: 'reached', status: 401 });
  expect(byId['xhr-preflight-get']).toMatchObject({ outcome: 'reached', status: 200 });
  expect(byId['service-get']?.outcome).toBe('unavailable');
  expect(report.corsVerdict).toBe('direct');

  await expect(page.getByTestId('cors-verdict')).toContainText('Direkte Anfragen funktionieren');
});

test('without a server parameter the CORS section says so and the report is still done', async ({
  page,
}) => {
  await page.goto(probeUrl);
  const report = await finishedReport(page);
  expect(report.server).toBeNull();
  expect(report.cors).toBeNull();
  expect(report.corsVerdict).toBeNull();
  await expect(page.getByTestId('no-server')).toContainText('Kein Server angegeben');
  await expect(page.getByTestId('cors-table')).toHaveCount(0);
});

test('shows media rows and re-runs the probe on Enter', async ({ page }) => {
  await page.goto(probeUrl);
  const first = await finishedReport(page);
  expect(first.media?.length).toBeGreaterThan(30);
  await expect(page.locator('[data-media]').first()).toBeVisible();
  expect(await page.locator('[data-media]').count()).toBe(first.media?.length);
  await expect(page.getByRole('button', { name: 'Erneut ausführen' })).toBeFocused();

  await page.keyboard.press('Enter');
  await page.waitForFunction(
    `window.__SILO_PROBE__ && window.__SILO_PROBE__.done === true && window.__SILO_PROBE__.startedAt !== ${JSON.stringify(first.startedAt)}`,
  );
  const second = await finishedReport(page);
  expect(second.startedAt).not.toBe(first.startedAt);
});
