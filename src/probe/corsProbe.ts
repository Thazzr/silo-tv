// Diagnostic CORS probe. Raw fetch/XHR is allowed here (and only here, besides the transport
// layer): the point is to see what the TV's web engine does with a cross-origin request from a
// file:// app. It never sends credentials and never logs request bodies.
import {
  getPlatform,
  type ProxyFetchRequest,
  type ProxyFetchResponse,
  type ProxyPingResponse,
} from '../platform';

export type CorsCheckId =
  | 'direct-simple'
  | 'direct-preflight-get'
  | 'direct-preflight-post'
  | 'xhr-preflight-get'
  | 'service-ping'
  | 'service-get'
  | 'service-post';

export type CorsTransport = 'fetch' | 'xhr' | 'service';
export type CorsOutcome = 'reached' | 'blocked' | 'error' | 'unavailable';

export interface CorsCheckResult {
  id: CorsCheckId;
  transport: CorsTransport;
  outcome: CorsOutcome;
  status?: number;
  detail?: string;
  ms: number;
}

export type CorsVerdict = 'direct' | 'service' | 'none';

export interface CorsProbeDeps {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  serviceFetch?: (req: ProxyFetchRequest) => Promise<ProxyFetchResponse>;
  servicePing?: () => Promise<ProxyPingResponse>;
  isWebOS?: () => boolean;
  now?: () => number;
}

export const CHECK_TIMEOUT_MS = 10_000;

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body?: string;
}

// A "simple" request: no custom headers, so the engine sends no preflight.
const SIMPLE_GET: RequestSpec = { method: 'GET', path: '/api/v2/system/info', headers: {} };
// A custom header forces a preflight.
const PREFLIGHT_GET: RequestSpec = {
  method: 'GET',
  path: '/api/v2/auth/device/capability',
  headers: { 'X-Silo-Device-Id': 'silo-tv-probe' },
};
// JSON content type forces a preflight; the token is invalid on purpose, so a reachable server
// answers 4xx and nothing real is ever sent.
const PREFLIGHT_POST: RequestSpec = {
  method: 'POST',
  path: '/api/v2/auth/refresh',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: 'silo-tv-probe-invalid' }),
};

type Verdict = Omit<CorsCheckResult, 'id' | 'transport' | 'ms'>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

async function fetchCheck(f: FetchFn, server: string, spec: RequestSpec): Promise<Verdict> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CHECK_TIMEOUT_MS);
  try {
    const response = await f(server + spec.path, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      credentials: 'omit',
      signal: controller.signal,
    });
    return { outcome: 'reached', status: response.status };
  } catch (error) {
    if (timedOut) return { outcome: 'error', detail: 'timeout' };
    // fetch rejects with a TypeError for network and CORS failures alike; the page cannot tell
    // them apart, which is exactly what "blocked" means here.
    if (error instanceof TypeError) return { outcome: 'blocked', detail: error.message };
    return { outcome: 'error', detail: messageOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

function xhrCheck(Xhr: typeof XMLHttpRequest, server: string, spec: RequestSpec): Promise<Verdict> {
  return new Promise<Verdict>((resolve) => {
    const xhr = new Xhr();
    xhr.open(spec.method, server + spec.path);
    for (const [name, value] of Object.entries(spec.headers)) xhr.setRequestHeader(name, value);
    xhr.timeout = CHECK_TIMEOUT_MS;
    xhr.withCredentials = false;
    xhr.onload = () => resolve({ outcome: 'reached', status: xhr.status });
    xhr.onerror = () => resolve({ outcome: 'blocked', detail: 'XHR network error' });
    xhr.ontimeout = () => resolve({ outcome: 'error', detail: 'timeout' });
    xhr.onabort = () => resolve({ outcome: 'error', detail: 'aborted' });
    try {
      xhr.send(spec.body ?? null);
    } catch (error) {
      resolve({ outcome: 'error', detail: messageOf(error) });
    }
  });
}

async function serviceCheck(
  call: (req: ProxyFetchRequest) => Promise<ProxyFetchResponse>,
  server: string,
  spec: RequestSpec,
): Promise<Verdict> {
  try {
    const response = await call({
      url: server + spec.path,
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    return { outcome: 'reached', status: response.status };
  } catch (error) {
    return { outcome: 'error', detail: messageOf(error) };
  }
}

export async function runCorsProbe(
  server: string,
  deps: CorsProbeDeps = {},
): Promise<CorsCheckResult[]> {
  const now = deps.now ?? Date.now;
  const platform = getPlatform();
  // The service checks only make sense where the platform offers the proxy.
  const onWebOS = (deps.isWebOS ?? (() => platform.proxyFetch !== undefined))();
  const results: CorsCheckResult[] = [];

  const run = async (id: CorsCheckId, transport: CorsTransport, check: () => Promise<Verdict>) => {
    const start = now();
    const verdict = await check();
    results.push({ id, transport, ...verdict, ms: now() - start });
  };
  const needsService = (check: () => Promise<Verdict>) => () =>
    onWebOS ? check() : Promise.resolve<Verdict>({ outcome: 'unavailable' });

  const f: FetchFn = (input, init) => (deps.fetch ?? fetch)(input, init);
  const xhrCtor = () => deps.XMLHttpRequest ?? XMLHttpRequest;
  const callService = (req: ProxyFetchRequest) => {
    const call = deps.serviceFetch ?? platform.proxyFetch;
    return call ? call(req) : Promise.reject(new Error('No proxy service on this platform'));
  };

  await run('direct-simple', 'fetch', () => fetchCheck(f, server, SIMPLE_GET));
  await run('direct-preflight-get', 'fetch', () => fetchCheck(f, server, PREFLIGHT_GET));
  await run('direct-preflight-post', 'fetch', () => fetchCheck(f, server, PREFLIGHT_POST));
  await run('xhr-preflight-get', 'xhr', () => xhrCheck(xhrCtor(), server, PREFLIGHT_GET));
  await run(
    'service-ping',
    'service',
    needsService(async () => {
      try {
        const ping = deps.servicePing ?? platform.proxyPing;
        if (!ping) throw new Error('No proxy service on this platform');
        const response = await ping();
        return { outcome: 'reached', detail: `node ${response.node} · sender ${response.sender}` };
      } catch (error) {
        return { outcome: 'error', detail: messageOf(error) };
      }
    }),
  );
  await run(
    'service-get',
    'service',
    needsService(() => serviceCheck(callService, server, PREFLIGHT_GET)),
  );
  await run(
    'service-post',
    'service',
    needsService(() => serviceCheck(callService, server, PREFLIGHT_POST)),
  );
  return results;
}

export function corsVerdict(results: readonly CorsCheckResult[]): CorsVerdict {
  const reached = (id: CorsCheckId) => results.some((r) => r.id === id && r.outcome === 'reached');
  if (reached('direct-preflight-get') && reached('direct-preflight-post')) return 'direct';
  if (reached('service-get') && reached('service-post')) return 'service';
  return 'none';
}
