import type { components } from '../../api/generated/schema';
import type { Transport } from '../../api/transport';
import { mediaUrlWithToken } from '../mediaUrl';
import { parseWebVtt, type Cue } from './webvtt';

type Subtitle = components['schemas']['SubtitleDecisionV3'];

/** The artifact URL of a plan's subtitle when the app draws it itself; null otherwise. */
export function sidecarUrl(subtitle: Subtitle | undefined): string | null {
  if (!subtitle || (subtitle.mode !== 'render' && subtitle.mode !== 'convert')) return null;
  return subtitle.artifact?.url || null;
}

export interface LoadOptions {
  baseUrl: string;
  token: string | undefined;
  transport: Transport;
  signal?: AbortSignal;
}

/**
 * Fetches one WebVTT sidecar through the transport and parses it. The URL is opaque; as for
 * media it gets the account token only on the Silo server's own origin. It is a credential in URL
 * form, so it is never logged. Any failure means no cues: subtitles are optional and the player
 * shows no error for them.
 *
 * Cue times are absolute source time (`timing_origin_seconds` 0); a plan that names another
 * origin has its cues moved by it.
 */
export async function loadSubtitleCues(subtitle: Subtitle, options: LoadOptions): Promise<Cue[]> {
  const path = sidecarUrl(subtitle);
  if (!path) return [];
  try {
    const url = mediaUrlWithToken(path, options.baseUrl, options.token);
    const request = new Request(url, { method: 'GET', signal: options.signal ?? null });
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
