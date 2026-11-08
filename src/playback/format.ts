/** `m:ss`, or `h:mm:ss` from one hour on. Negative and non-finite values show as zero. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Makes a text safe to show: removes every secret it contains and any URL. Media errors can
 * carry the failing URL, and the media URL holds the account token.
 */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    // Also the URL-encoded form: that is how a token appears inside a URL.
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      result = result.split(form).join('[hidden]');
    }
  }
  return result.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]');
}
