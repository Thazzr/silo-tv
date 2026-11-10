import type { components } from '../../api/generated/schema';
import type { Session } from '../../api/session';
import type { Transport } from '../../api/transport';
import { authHeadersFor, mediaUrlWithToken } from '../mediaUrl';
import { parseWebVtt, type Cue } from './webvtt';

type Subtitle = components['schemas']['SubtitleDecisionV3'];

/** The artifact URL of a plan's subtitle when the app draws it itself; null otherwise. */
export function sidecarUrl(subtitle: Subtitle | undefined): string | null {
  if (!subtitle || (subtitle.mode !== 'render' && subtitle.mode !== 'convert')) return null;
  return subtitle.artifact?.url || null;
}

export interface LoadOptions {
  baseUrl: string;
  /** Read per load, so the sidecar request carries the current token. */
  session: Pick<Session, 'get'>;
  transport: Transport;
  signal?: AbortSignal;
}

/**
 * Fetches one WebVTT sidecar through the transport and parses it. The URL is opaque and stays
 * token-free; the request authenticates with headers, only on the Silo server's own origin. Any failure means no cues: subtitles are optional and the player
 * shows no error for them.
 *
 * Cue times are absolute source time (`timing_origin_seconds` 0); a plan that names another
 * origin has its cues moved by it.
 */
export async function loadSubtitleCues(subtitle: Subtitle, options: LoadOptions): Promise<Cue[]> {
  const path = sidecarUrl(subtitle);
  if (!path) return [];
  try {
    // Resolved against the server: the app itself runs from file://, so a relative URL needs it.
    const url = mediaUrlWithToken(path, options.baseUrl, undefined);
    const request = new Request(url, {
      method: 'GET',
      headers: authHeadersFor(url, options.baseUrl, options.session.get()),
      signal: options.signal ?? null,
    });
    const response = await options.transport(request);
    if (!response.ok) return [];
    const cues = parseWebVtt(await response.text());
    const origin = subtitle.artifact?.timing_origin_seconds ?? 0;
    return origin === 0
      ? cues
      : cues.map((cue) => ({ ...cue, start: cue.start + origin, end: cue.end + origin }));
  } catch {
    return [];
  }
}
