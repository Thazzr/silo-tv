import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { formatClock, redact } from './format';
import type { MediaFailure, Plan } from './usePlaybackSession';

interface Snapshot {
  size: string;
  time: string;
  buffered: string;
  rate: string;
  ready: string;
  network: string;
}

const EMPTY: Snapshot = {
  size: '-',
  time: '-',
  buffered: '-',
  rate: '-',
  ready: '-',
  network: '-',
};

function snapshot(video: HTMLVideoElement | null): Snapshot {
  if (!video) return EMPTY;
  const ranges = video.buffered;
  const end = ranges.length > 0 ? ranges.end(ranges.length - 1) : 0;
  return {
    size: `${video.videoWidth}×${video.videoHeight}`,
    time: formatClock(video.currentTime),
    buffered: formatClock(end),
    rate: String(video.playbackRate),
    ready: String(video.readyState),
    network: String(video.networkState),
  };
}

const EVENTS = ['timeupdate', 'progress', 'ratechange', 'waiting', 'playing', 'loadedmetadata'];

/**
 * Playback diagnostics: what the plan says and what the engine reports. It never shows the
 * media URL or any token; texts that may contain them pass through `redact` first.
 */
export function PlayerDiagnostics({
  plan,
  sessionId,
  video,
  mediaError,
  secrets,
}: {
  plan?: Plan;
  sessionId?: string;
  video: HTMLVideoElement | null;
  mediaError: MediaFailure | null;
  secrets: readonly (string | undefined)[];
}) {
  const t = useT();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    const update = () => setSnap(snapshot(video));
    // Not called synchronously: the first reading comes right after mount.
    const first = setTimeout(update, 0);
    const interval = setInterval(update, 1000);
    for (const name of EVENTS) video?.addEventListener(name, update);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      for (const name of EVENTS) video?.removeEventListener(name, update);
    };
  }, [video]);

  const recipe = plan?.effective_recipe;
  const source = plan?.source;
  const rows: [string, string][] = [
    [t('player.diag.route'), plan?.delivery ?? '-'],
    [t('player.diag.container'), plan?.stream.container ?? source?.container ?? '-'],
    [t('player.diag.video'), recipe?.video_codec ?? source?.video_codec ?? '-'],
    [t('player.diag.audio'), recipe?.audio_codec ?? source?.audio_codec ?? '-'],
    [t('player.diag.resolution'), snap.size],
    [t('player.diag.time'), snap.time],
    [t('player.diag.buffered'), snap.buffered],
    [t('player.diag.rate'), snap.rate],
    [t('player.diag.ready'), snap.ready],
    [t('player.diag.network'), snap.network],
    [
      t('player.diag.error'),
      mediaError ? redact(`${mediaError.code} ${mediaError.message}`.trim(), secrets) : '-',
    ],
    [t('player.diag.session'), sessionId ? sessionId.slice(0, 8) : '-'],
  ];

  return (
    <dl className="player-diag" data-testid="player-diagnostics">
      {rows.map(([label, value]) => (
        <div key={label} className="player-diag-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
