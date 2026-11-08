import { probeMedia } from '../platform/mediaProbe';
import type { ProbeReport } from '../probe/runProbe';

export function makeReport(overrides: Partial<ProbeReport> = {}): ProbeReport {
  return {
    appVersion: __APP_VERSION__,
    startedAt: '2026-11-08T10:00:00.000Z',
    finishedAt: '2026-11-08T10:00:01.000Z',
    done: true,
    device: {
      platform: 'webos',
      userAgent: 'Mozilla/5.0 Chrome/79.0.3945.79',
      screen: { width: 1920, height: 1080, colorDepth: 24 },
      devicePixelRatio: 1,
      chromeMajor: 79,
      platformVersion: '6.0.0',
      systemInfo: {
        modelName: 'OLED55C1',
        firmwareVersion: '03.30.21',
        sdkVersion: '6.0.0',
        UHD: 'true',
      },
      configs: { 'tv.model.edidType': 'lg-probe-raw' },
    },
    display: {
      dynamicRangeHigh: true,
      videoDynamicRangeHigh: false,
      colorDepth: 24,
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
    },
    media: probeMedia({
      canPlayType: (mime) => (mime.includes('avc1') ? 'probably' : ''),
      isTypeSupported: (mime) => mime.includes('avc1'),
    }),
    decoding: null,
    server: { origin: 'https://silo.example.test' },
    cors: [
      { id: 'direct-simple', transport: 'fetch', outcome: 'reached', status: 200, ms: 12 },
      { id: 'direct-preflight-get', transport: 'fetch', outcome: 'blocked', detail: 'x', ms: 3 },
      { id: 'direct-preflight-post', transport: 'fetch', outcome: 'blocked', ms: 4 },
      { id: 'xhr-preflight-get', transport: 'xhr', outcome: 'blocked', ms: 5 },
      { id: 'service-ping', transport: 'service', outcome: 'reached', detail: 'v8.12.0', ms: 6 },
      { id: 'service-get', transport: 'service', outcome: 'reached', status: 200, ms: 7 },
      { id: 'service-post', transport: 'service', outcome: 'reached', status: 401, ms: 8 },
    ],
    corsVerdict: 'service',
    errors: [],
    ...overrides,
  };
}
