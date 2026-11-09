import type { ReactNode } from 'react';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { formatClock } from '../../playback/format';

export const PLAY_KEY = 'detail-play';
export const START_OVER_KEY = 'detail-start-over';

/** The episode the primary action of a series plays, for its label ("Play S2 · E3"). */
export interface EpisodeRef {
  season: number;
  episode: number;
}

/**
 * Play, or Resume where the watch state says so and then Start over. `extras` is the place for
 * the round buttons that follow later (Watchlist, More); it renders after the pills.
 */
export function ActionRow({
  resumeSeconds,
  episode,
  autoFocus,
  onPlay,
  onResume,
  onStartOver,
  onFocused,
  extras,
}: {
  /** The resume point, or null when the item plays from the start. */
  resumeSeconds: number | null;
  /** Set on a series: the label names the episode. */
  episode?: EpisodeRef;
  autoFocus: boolean;
  onPlay: () => void;
  onResume: () => void;
  onStartOver: () => void;
  onFocused: () => void;
  extras?: ReactNode;
}) {
  const t = useT();
  const resuming = resumeSeconds !== null;
  let label: string;
  if (resuming) {
    label = episode
      ? t('detail.resumeEpisode', { season: episode.season, episode: episode.episode })
      : t('detail.resumeFrom', { time: formatClock(resumeSeconds) });
  } else {
    label = episode
      ? t('detail.playEpisode', { season: episode.season, episode: episode.episode })
      : t('detail.play');
  }
  return (
    <div className="detail-row detail-actions" role="group" data-testid="detail-actions">
      <Button
        focusKey={PLAY_KEY}
        className="detail-pill detail-play"
        autoFocus={autoFocus}
        onFocused={onFocused}
        onClick={resuming ? onResume : onPlay}
      >
        {label}
      </Button>
      {resuming ? (
        <Button
          focusKey={START_OVER_KEY}
          className="detail-pill"
          onFocused={onFocused}
          onClick={onStartOver}
        >
          {t('detail.startOver')}
        </Button>
      ) : null}
      {extras}
    </div>
  );
}
