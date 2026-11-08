import {
  getPlatform,
  type DecodingResult,
  type DeviceInfo,
  type DisplayInfo,
  type ProbeRow,
} from '../platform';
import { corsVerdict, runCorsProbe, type CorsCheckResult, type CorsVerdict } from './corsProbe';

export interface ProbeReport {
  appVersion: string;
  startedAt: string;
  finishedAt: string;
  done: true;
  device: DeviceInfo | null;
  display: DisplayInfo | null;
  media: ProbeRow[] | null;
  decoding: Record<string, DecodingResult> | null;
  server: { origin: string } | null;
  cors: CorsCheckResult[] | null;
  corsVerdict: CorsVerdict | null;
  errors: string[];
}

export interface ProbeRunning {
  done: false;
  startedAt: string;
}

declare global {
  interface Window {
    /** Probe results for remote reading (tv:eval); see runProbe. */
    __SILO_PROBE__?: ProbeReport | ProbeRunning;
  }
}

export interface ProbeDeps {
  launchParams?: () => Record<string, unknown>;
  device?: () => Promise<DeviceInfo>;
  display?: () => DisplayInfo;
  media?: () => ProbeRow[];
  decoding?: () => Promise<Record<string, DecodingResult> | null>;
  cors?: (server: string) => Promise<CorsCheckResult[]>;
  now?: () => number;
}

/** Only an http(s) URL is a server; everything is reduced to its origin. */
export function normalizeServer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

let lastStarted = 0;

export async function runProbe(deps: ProbeDeps = {}): Promise<ProbeReport> {
  const now = deps.now ?? Date.now;
  // Strictly increasing, so two runs within one millisecond still differ.
  const started = Math.max(now(), lastStarted + 1);
  lastStarted = started;
  const startedAt = new Date(started).toISOString();
  window.__SILO_PROBE__ = { done: false, startedAt };

  const errors: string[] = [];
  const part = async <T>(name: string, run: () => T | Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const platform = getPlatform();
  const device = await part('device', deps.device ?? (() => platform.readDeviceInfo()));
  const display = await part('display', deps.display ?? (() => platform.probeDisplay()));
  const media = await part('media', deps.media ?? (() => platform.probeMedia()));
  const decoding = await part('decoding', deps.decoding ?? (() => platform.probeDecodingInfo()));

  const origin = normalizeServer(
    (deps.launchParams ?? (() => platform.readLaunchParams()))().server,
  );
  const corsRun = deps.cors ?? ((server: string) => runCorsProbe(server));
  const cors = origin ? await part('cors', () => corsRun(origin)) : null;

  const report: ProbeReport = {
    appVersion: __APP_VERSION__,
    startedAt,
    finishedAt: new Date(Math.max(now(), started)).toISOString(),
    done: true,
    device,
    display,
    media,
    decoding,
    server: origin ? { origin } : null,
    cors,
    corsVerdict: cors ? corsVerdict(cors) : null,
    errors,
  };
  window.__SILO_PROBE__ = report;
  console.info('[probe] ' + JSON.stringify(report));
  return report;
}
