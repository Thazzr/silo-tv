import { getPlatform } from '../../platform';
import type { Transport } from './types';

// A response with these statuses must not carry a body (the Response constructor throws).
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Sends the request through the bundled JS service, which runs outside the browser's CORS rules.
 * The service returns text only. It does not follow redirects, so a 3xx comes back unchanged and
 * the credentials never travel to another origin.
 */
export const serviceTransport: Transport = async (request) => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.text() : '';

  // The proxy exists only where the platform bundles a service (webOS).
  const proxyFetch = getPlatform().proxyFetch;
  if (!proxyFetch) {
    // Same shape as a browser network failure, so callers handle one kind of "unreachable".
    throw new TypeError('Network request failed: no proxy service on this platform');
  }

  let result;
  try {
    result = await proxyFetch({
      url: request.url,
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
  } catch (error) {
    // Same shape as a browser network failure, so callers handle one kind of "unreachable".
    throw new TypeError(
      `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return new Response(NULL_BODY_STATUSES.has(result.status) ? null : result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
};
