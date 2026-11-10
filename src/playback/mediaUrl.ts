import type { SessionData } from '../api/session';

/**
 * The headers a request to `url` carries to authenticate as the signed-in viewer: the bearer token
 * and the profile headers, only when the URL is on the Silo server's own origin. Every other origin
 * (a proxy or transcode node) gets none, so the account token never leaves for it. Pass the
 * session's current data on every call: a refreshed token then applies to the next request.
 *
 * The result holds credentials: never log it.
 */
export function authHeadersFor(
  url: string,
  serverOrigin: string,
  session: Pick<SessionData, 'accessToken' | 'profileId' | 'profileToken'> | null | undefined,
): Record<string, string> {
  if (!session?.accessToken) return {};
  try {
    const server = new URL(serverOrigin);
    if (new URL(url, server).origin !== server.origin) return {};
  } catch {
    return {};
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${session.accessToken}` };
  if (session.profileId) headers['X-Profile-Id'] = session.profileId;
  if (session.profileToken) headers['X-Profile-Token'] = session.profileToken;
  return headers;
}

/**
 * The URL a `<video>` loads for a plan. The plan's URL is opaque: nothing is built or edited
 * here except one thing the docs allow. A media element cannot set an Authorization header, so
 * a URL on the Silo server's own origin gets the account token as the `token` query parameter.
 * Any other origin (a proxy or transcode node) carries its own signed credential and is
 * returned exactly as the server sent it; the account token never leaves for another origin.
 *
 * The returned value is a credential in URL form: never log it or put it on screen.
 */
export function mediaUrlWithToken(
  streamUrl: string,
  serverOrigin: string,
  token: string | undefined,
): string {
  let resolved: URL;
  let server: URL;
  try {
    server = new URL(serverOrigin);
    resolved = new URL(streamUrl, server);
  } catch {
    return streamUrl;
  }
  if (resolved.origin !== server.origin) return streamUrl;

  // A relative URL is made absolute against the server: the app itself runs from file://.
  if (!token) return resolved.href;

  // Appended as text so the signed query the server sent is not decoded or re-encoded.
  const hash = resolved.hash;
  const base = resolved.href.slice(0, resolved.href.length - hash.length);
  const separator = base.endsWith('?') ? '' : resolved.search ? '&' : '?';
  return `${base}${separator}token=${encodeURIComponent(token)}${hash}`;
}
