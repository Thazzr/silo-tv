import { createSiloClient } from './client';
import { getDeviceIdentity, type DeviceIdentity } from './deviceIdentity';
import type { components } from './generated/schema';
import { Session } from './session';
import type { Transport } from './transport';

export type SystemInfo = components['schemas']['SystemInfo'];

export type ServerCheckResult =
  | { ok: true; info: SystemInfo }
  | { ok: false; reason: 'unreachable' | 'not_silo' | 'unsupported_api' };

const SCHEME = /^https?:\/\//i;
const HOST_PORT = /^[^/?#:]+:\d+(?:[/?#]|$)/;

/**
 * Turns what a user typed into a server origin: `https://` is added when the scheme is missing,
 * an explicit `http://` is kept, and path, query and trailing slash are dropped. Returns null for
 * anything that is not an http(s) address.
 */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let candidate = text;
  if (!SCHEME.test(text)) {
    // `host:8080` has no scheme, but `javascript:...` and `ftp://...` carry a foreign one.
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !HOST_PORT.test(text)) return null;
    candidate = `https://${text}`;
  }
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Asks `GET /api/v2/system/info`; only a server that answers `api_major === 2` is accepted. */
export async function checkServer(
  baseUrl: string,
  transport: Transport,
  device: DeviceIdentity = getDeviceIdentity(),
): Promise<ServerCheckResult> {
  const client = createSiloClient({ baseUrl, transport, session: new Session(null), device });
  try {
    const { data, response } = await client.GET('/api/v2/system/info');
    if (!data) {
      return { ok: false, reason: response.status >= 502 ? 'unreachable' : 'not_silo' };
    }
    if (data.api_major !== 2) {
      return {
        ok: false,
        reason: typeof data.api_major === 'number' ? 'unsupported_api' : 'not_silo',
      };
    }
    return { ok: true, info: data };
  } catch (error) {
    // The transport throws a TypeError when nothing answered; a body that is not JSON (an HTML
    // page from some other web server) is a SyntaxError.
    return { ok: false, reason: error instanceof TypeError ? 'unreachable' : 'not_silo' };
  }
}
