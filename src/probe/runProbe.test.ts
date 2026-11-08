import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceInfo, DisplayInfo, ProbeRow } from '../platform';
import type { CorsCheckResult } from './corsProbe';
import { normalizeServer, runProbe, type ProbeDeps } from './runProbe';

const device: DeviceInfo = {
  platform: 'webos',
  userAgent: 'ua',
  screen: { width: 1920, height: 1080, colorDepth: 24 },
  devicePixelRatio: 1,
};
const display: DisplayInfo = {
  dynamicRangeHigh: false,
  videoDynamicRangeHigh: false,
  colorDepth: 24,
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
};
const media: ProbeRow[] = [
  { id: 'mp4', label: 'MP4', mime: 'video/mp4', canPlayType: 'maybe', mse: true },
];
const reached = (id: CorsCheckResult['id']): CorsCheckResult => ({
  id,
  transport: 'fetch',
  outcome: 'reached',
  status: 200,
  ms: 1,
});

function deps(overrides: ProbeDeps = {}): ProbeDeps {
  return {
    launchParams: () => ({ server: 'https://silo.example.test' }),
    device: () => Promise.resolve(device),
    display: () => display,
    media: () => media,
    decoding: () => Promise.resolve(null),
    cors: () =>
      Promise.resolve([reached('direct-preflight-get'), reached('direct-preflight-post')]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__SILO_PROBE__;
});

describe('normalizeServer', () => {
  it.each([
    ['https://silo.example.test', 'https://silo.example.test'],
    ['https://silo.example.test/', 'https://silo.example.test'],
    ['https://silo.example.test/app/path?x=1#h', 'https://silo.example.test'],
    ['http://192.168.1.5:8080/api', 'http://192.168.1.5:8080'],
    ['  https://silo.example.test  ', 'https://silo.example.test'],
  ])('reduces %j to its origin', (input, expected) => {
    expect(normalizeServer(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'ftp://silo.example.test',
    'file:///etc/passwd',
    'not a url',
    '',
    undefined,
    42,
  ])('rejects %j', (input) => {
    expect(normalizeServer(input)).toBeNull();
  });
});

describe('runProbe', () => {
  it('builds a complete report with the normalised server and the verdict', async () => {
    const report = await runProbe(
      deps({ launchParams: () => ({ server: 'https://silo.example.test/x/' }) }),
    );
    expect(report).toMatchObject({
      appVersion: __APP_VERSION__,
      done: true,
      device,
      display,
      media,
      decoding: null,
      server: { origin: 'https://silo.example.test' },
      corsVerdict: 'direct',
      errors: [],
    });
    expect(report.cors).toHaveLength(2);
  });

  it('passes the normalised origin to the CORS probe', async () => {
    const cors = vi.fn<NonNullable<ProbeDeps['cors']>>(() => Promise.resolve([]));
    await runProbe(deps({ cors, launchParams: () => ({ server: 'https://silo.example.test/a' }) }));
    expect(cors).toHaveBeenCalledWith('https://silo.example.test');
  });

  it.each(['javascript:alert(1)', 'ftp://x.test', 'garbage', undefined])(
    'skips the CORS probe for server %j',
    async (server) => {
      const cors = vi.fn<NonNullable<ProbeDeps['cors']>>(() => Promise.resolve([]));
      const report = await runProbe(deps({ cors, launchParams: () => ({ server }) }));
      expect(cors).not.toHaveBeenCalled();
      expect(report).toMatchObject({ done: true, server: null, cors: null, corsVerdict: null });
    },
  );

  it('records a failing part in errors and still completes the report', async () => {
    const report = await runProbe(
      deps({
        device: () => Promise.reject(new Error('luna down')),
        media: () => {
          throw new Error('no video element');
        },
        cors: () => Promise.reject(new Error('probe crashed')),
      }),
    );
    expect(report.done).toBe(true);
    expect(report.device).toBeNull();
    expect(report.media).toBeNull();
    expect(report.display).toEqual(display);
    expect(report.cors).toBeNull();
    expect(report.errors).toEqual([
      'device: luna down',
      'media: no video element',
      'cors: probe crashed',
    ]);
  });

  it('publishes the report on window and logs exactly one [probe] line', async () => {
    const report = await runProbe(deps());
    expect(window.__SILO_PROBE__).toBe(report);
    const info = vi.mocked(console.info);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line.startsWith('[probe] ')).toBe(true);
    expect(JSON.parse(line.slice('[probe] '.length))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it('holds a running marker until the probe completes', async () => {
    let release: ((value: CorsCheckResult[]) => void) | undefined;
    const cors = () =>
      new Promise<CorsCheckResult[]>((resolve) => {
        release = resolve;
      });
    const promise = runProbe(deps({ cors }));
    expect(window.__SILO_PROBE__).toEqual({
      done: false,
      startedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(window.__SILO_PROBE__?.done).toBe(false);
    release?.([]);
    await promise;
    expect(window.__SILO_PROBE__?.done).toBe(true);
  });

  it('gives consecutive runs different startedAt values even with a frozen clock', async () => {
    const a = await runProbe(deps({ now: () => 5 }));
    const b = await runProbe(deps({ now: () => 5 }));
    expect(b.startedAt).not.toBe(a.startedAt);
  });
});
