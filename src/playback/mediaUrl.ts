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
