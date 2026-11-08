import { describe, expect, it } from 'vitest';
import { SiloApiError, parseRetryAfter, problemFromResponse } from './problem';

describe('problemFromResponse', () => {
  it('parses a full problem document', async () => {
    const error = await problemFromResponse(
      new Response(
        JSON.stringify({
          type: 'https://siloserver.org/docs/api/v2/problems/token_refresh_required',
          title: 'Token refresh required',
          status: 401,
          detail: 'Refresh the session.',
          instance: 'urn:silo:request:1',
        }),
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    expect(error).toBeInstanceOf(SiloApiError);
    expect(error).toMatchObject({
      status: 401,
      code: 'token_refresh_required',
      title: 'Token refresh required',
      detail: 'Refresh the session.',
      retryAfter: undefined,
    });
  });

  it('prefers an explicit code member over the type', async () => {
    const error = await problemFromResponse(
      new Response(JSON.stringify({ code: 'explicit', type: 'https://x/problems/other' }), {
        status: 400,
      }),
    );
    expect(error.code).toBe('explicit');
  });

  it('tolerates missing fields', async () => {
    const error = await problemFromResponse(new Response('{}', { status: 422 }));
    expect(error).toMatchObject({ status: 422, code: '', title: '', detail: '' });
    expect(error.message).toBe('HTTP 422');
  });

  it('still yields the status for a body that is not JSON', async () => {
    const html = await problemFromResponse(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    expect(html).toMatchObject({ status: 502, code: '' });
    const array = await problemFromResponse(new Response('[1]', { status: 500 }));
    expect(array.status).toBe(500);
  });

  it('reads Retry-After', async () => {
    const error = await problemFromResponse(
      new Response('{}', { status: 503, headers: { 'Retry-After': '30' } }),
    );
    expect(error.retryAfter).toBe(30);
  });
});

describe('parseRetryAfter', () => {
  it('handles seconds, HTTP dates and garbage', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('12', now)).toBe(12);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});
