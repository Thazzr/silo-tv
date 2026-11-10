import { useEffect, useState } from 'react';
import { currentTransport } from '../../api/transport';
import { useSilo } from '../../app/SiloContext';
import type { Plan } from '../usePlaybackSession';
import { loadSubtitleCues, sidecarUrl } from './loader';
import type { Cue } from './webvtt';

const NONE: Cue[] = [];

/**
 * The cues of the plan's selected subtitle: loaded again whenever a plan names another artifact
 * (track change, reanchor), empty for no subtitle, burn-in or a failed fetch.
 */
export function useSubtitleCues(plan: Plan): Cue[] {
  const { baseUrl, session } = useSilo();
  const url = sidecarUrl(plan.subtitle);
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);

  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    let current = true;
    void loadSubtitleCues(plan.subtitle, {
      baseUrl,
      token: session.get()?.accessToken,
      transport: currentTransport,
      signal: abort.signal,
    }).then((cues) => {
      if (current) setLoaded({ url, cues });
    });
    return () => {
      current = false;
      abort.abort();
    };
    // The artifact URL identifies the subtitle; the rest of the plan may change without it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, baseUrl, session]);

  // Cues of an earlier subtitle are never shown for the new one while it loads.
  return url && loaded?.url === url ? loaded.cues : NONE;
}
