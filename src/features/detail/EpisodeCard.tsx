import { CircleCheck } from 'lucide-react';
import { useLanguage, useT } from '../../i18n';
import {
  Artwork,
  CardFrame,
  protectsEpisodeOverview,
  protectsEpisodeStill,
  useMediaUrl,
  useSpoilerSettings,
} from '../../ui/media';
import {
  episodeCaptionTitle,
  episodeMetaLine,
  episodeProgress,
  episodeWatched,
  type Episode,
} from './info';
import { onPlayKey } from './playKey';

/**
 * An episode as a card: its still with the progress bar, then "S01E03 · Title" with the watched
 * check, the air date and runtime, and three lines of synopsis (hidden, like the still, while spoiler
 * protection covers an unwatched episode). The episode grid and the "More Episodes" row of an
 * episode's page draw the same card; OK opens the episode's page, the Play key plays it. `current`
 * marks the episode whose page it is: an outline ring, the title in the text colour and a "Now
 * Viewing" badge.
 */
export function EpisodeCard({
  episode,
  focusKey,
  onOpen,
  onPlay,
  onFocused,
  current = false,
}: {
  episode: Episode;
  focusKey: string;
  onOpen: (episode: Episode) => void;
  onPlay: (episode: Episode) => void;
  onFocused: () => void;
  current?: boolean;
}) {
  const t = useT();
  const lang = useLanguage();
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  const progress = episodeProgress(episode);
  const title = episodeCaptionTitle(episode, t);
  return (
    <CardFrame
      focusKey={focusKey}
      variant="landscape"
      className={current ? 'card-episode card-episode-current' : 'card-episode'}
      onClick={() => onOpen(episode)}
      onFocused={onFocused}
      onKeyDown={onPlayKey(() => onPlay(episode))}
      art={
        <>
          <Artwork
            src={url(episode.still_url)}
            thumbhash={episode.still_thumbhash}
            title={title}
            protect={protectsEpisodeStill(episode, spoilers)}
          />
          {progress !== null ? (
            <span className="card-progress" aria-hidden="true">
              <span
                className="card-progress-fill"
                data-testid="card-progress"
                style={{ width: `${Math.round(progress * 1000) / 10}%` }}
              />
            </span>
          ) : null}
          {current ? (
            <>
              <span className="episode-current-ring" aria-hidden="true" />
              <span className="episode-now" data-testid="episode-now">
                <span className="episode-now-dot" aria-hidden="true" />
                {t('detail.nowViewing')}
              </span>
            </>
          ) : null}
        </>
      }
      caption={
        <>
          <span className="card-title episode-heading">
            <span className="episode-title" data-testid="episode-title">
              {title}
            </span>
            {episodeWatched(episode) ? (
              <span
                className="episode-check"
                data-testid="episode-watched"
                role="img"
                aria-label={t('detail.watched')}
              >
                <CircleCheck size={24} aria-hidden="true" />
              </span>
            ) : null}
          </span>
          <span className="card-sub" data-testid="episode-meta">
            {episodeMetaLine(episode, lang, t)}
          </span>
          {protectsEpisodeOverview(episode, spoilers) ? (
            <span
              className="episode-synopsis episode-synopsis-hidden"
              data-testid="episode-synopsis-hidden"
            >
              {t('detail.descriptionHidden')}
            </span>
          ) : (
            <span className="episode-synopsis" data-testid="episode-synopsis">
              {episode.overview ?? ''}
            </span>
          )}
        </>
      }
    />
  );
}
