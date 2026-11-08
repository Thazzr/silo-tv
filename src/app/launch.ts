import { readLaunchParams } from '../platform/launchParams';
import type { TransportMode } from '../api/transport';

export interface Launch {
  /** Show the diagnostics screen instead of the app flow. */
  probe: boolean;
  /** Transport mode to set before the first request; null keeps the default. */
  transport: TransportMode | null;
  /** Server address to pre-fill on the server screen (still normalized and checked there). */
  server: string;
}

const FALSE_WORDS = new Set(['0', 'false', 'no', 'off']);

// `?probe` (no value) must count as set, so only explicit "off" words and absence are false.
function isSet(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return !FALSE_WORDS.has(value.toLowerCase());
  return Boolean(value);
}

export function parseLaunch(params: Record<string, unknown> = readLaunchParams()): Launch {
  const transport = params.transport;
  return {
    probe: isSet(params.probe),
    transport: transport === 'direct' || transport === 'service' ? transport : null,
    server: typeof params.server === 'string' ? params.server.trim() : '',
  };
}
