import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { DeviceIdentity } from './deviceIdentity';
import type { paths } from './generated/schema';
import { SiloApiError, parseRetryAfter, problemCode } from './problem';
import type { Session } from './session';
import type { Transport } from './transport';

export type SiloClient = Client<paths>;

export interface SiloClientOptions {
  /** Server origin, e.g. `https://silo.example`; the spec's paths already contain `/api/v2`. */
  baseUrl: string;
  transport: Transport;
  session: Session;
  device: DeviceIdentity;
  /** Defaults to the app version baked in at build time. */
  clientVersion?: string;
}

const REFRESH_CODES = new Set(['invalid_token', 'token_refresh_required']);

// Header values must be ISO-8859-1; keep names printable ASCII so a model name cannot break a call.
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '');
}

function deviceMiddleware(options: SiloClientOptions): Middleware {
  const version = options.clientVersion ?? __APP_VERSION__;
  return {
    onRequest({ request }) {
      request.headers.set('X-Silo-Device-Id', options.device.id);
      request.headers.set('X-Silo-Device-Name', headerSafe(options.device.name));
      request.headers.set('X-Silo-Device-Platform', 'webos');
      request.headers.set('X-Silo-Client', 'silo-tv');
      request.headers.set('X-Silo-Client-Version', version);
      return request;
    },
  };
}

function authMiddleware(session: Session): Middleware {
  return {
    onRequest({ request }) {
      const current = session.get();
      if (!current) return request;
      request.headers.set('Authorization', `Bearer ${current.accessToken}`);
      if (current.profileId) request.headers.set('X-Profile-Id', current.profileId);
      if (current.profileToken) request.headers.set('X-Profile-Token', current.profileToken);
      return request;
    },
  };
}

async function needsRefresh(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body: unknown = JSON.parse(await response.clone().text());
    return (
      body !== null &&
      typeof body === 'object' &&
      REFRESH_CODES.has(problemCode(body as Record<string, unknown>))
    );
  } catch {
    return false;
  }
}

/**
 * Creates the API client. Every request carries the device headers; authenticated requests also
 * carry the bearer token and profile headers. A 401 `invalid_token` / `token_refresh_required`
 * triggers one shared refresh and one retry of the failed request.
 */
export function createSiloClient(options: SiloClientOptions): SiloClient {
  const { baseUrl, transport, session } = options;

  // The refresh call goes through a client of its own: no auth header, no retry, no recursion.
  const refreshClient = createClient<paths>({ baseUrl, fetch: transport });
  refreshClient.use(deviceMiddleware(options));

  let refreshing: Promise<Response | null> | null = null;

  /** Runs one refresh. Resolves null on success, or the response to hand back to the caller. */
  async function runRefresh(): Promise<Response | null> {
    const current = session.get();
    if (!current) return null;
    const { data, error, response } = await refreshClient.POST('/api/v2/auth/refresh', {
      body: { refresh_token: current.refreshToken },
    });
    if (data) {
      session.update({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      });
      return null;
    }
    // Only a refused refresh ends the session; 503 and other failures keep the tokens.
    if (response.status === 401) session.signOut();
    // openapi-fetch has consumed the body, so hand the caller a fresh copy of the failure.
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
    return new Response(JSON.stringify(error ?? {}), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /** Single flight: every failed request waits for the same refresh. */
  function refresh(): Promise<Response | null> {
    refreshing ??= runRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  const fetchWithRefresh = async (request: Request): Promise<Response> => {
    const sentAuth = request.headers.get('Authorization');
    const retryable = sentAuth ? request.clone() : null;
    const response = await transport(request);
    if (!retryable || !sentAuth || !(await needsRefresh(response))) return response;

    // Another request may already have refreshed while this one was in flight.
    const sentToken = sentAuth.replace(/^Bearer /, '');
    if (session.get()?.accessToken === sentToken) {
      const failure = await refresh();
      // A refused refresh signed the user out: the caller sees the original 401. Any other
      // failure (503 with Retry-After) is handed back as is so the caller can retry later.
      if (failure) return failure.status === 401 ? response : failure;
    }
    const renewed = session.get();
    if (!renewed) return response;
    retryable.headers.set('Authorization', `Bearer ${renewed.accessToken}`);
    // Exactly one retry: whatever comes back, including another 401, is final.
    return transport(retryable);
  };

  const client = createClient<paths>({ baseUrl, fetch: fetchWithRefresh });
  client.use(deviceMiddleware(options), authMiddleware(session));
  return client;
}

/** Turns an openapi-fetch error result into a SiloApiError, for queryFns that must throw. */
export function toApiError(error: unknown, response: Response): SiloApiError {
  const body =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return new SiloApiError({
    status: response.status,
    code: problemCode(body),
    title: typeof body.title === 'string' ? body.title : undefined,
    detail: typeof body.detail === 'string' ? body.detail : undefined,
    retryAfter: parseRetryAfter(response.headers.get('Retry-After')),
  });
}
