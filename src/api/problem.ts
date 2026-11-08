/** RFC 9457 problem details as Silo sends them, reduced to what the app acts on. */
export class SiloApiError extends Error {
  readonly status: number;
  /** Stable problem identifier, e.g. `token_refresh_required`; empty when the body had none. */
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  /** Seconds to wait before retrying, from the Retry-After header. */
  readonly retryAfter: number | undefined;

  constructor(init: {
    status: number;
    code?: string;
    title?: string;
    detail?: string;
    retryAfter?: number;
  }) {
    const title = init.title ?? '';
    super(title || `HTTP ${init.status}`);
    this.name = 'SiloApiError';
    this.status = init.status;
    this.code = init.code ?? '';
    this.title = title;
    this.detail = init.detail ?? '';
    this.retryAfter = init.retryAfter;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Silo puts the identifier in the last segment of `type`; a `code` member wins when present. */
export function problemCode(body: Record<string, unknown>): string {
  const code = text(body.code);
  if (code) return code;
  const type = text(body.type);
  if (!type) return '';
  const last = type.split(/[/#]/).filter(Boolean).pop();
  return last ?? '';
}

export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

/** Builds an error from a non-OK response; a body that is not JSON still yields the status. */
export async function problemFromResponse(response: Response): Promise<SiloApiError> {
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON (a proxy's HTML error page, an empty body): fall through with the status only.
  }
  return new SiloApiError({
    status: response.status,
    code: problemCode(body),
    title: text(body.title),
    detail: text(body.detail),
    retryAfter,
  });
}
