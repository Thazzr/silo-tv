import { useCallback, useEffect, useState } from 'react';
import { FocusGroup } from '../../app/nav';
import { useT } from '../../i18n';
import {
  Artwork,
  CardFrame,
  CardSkeleton,
  FocusIndexMemory,
  mountedIndices,
  nextScrollIndex,
  useMediaUrl,
} from '../../ui/media';
import { DETAIL_INSET, EPISODE_STEP, EPISODE_STRIP_HEIGHT, episodesVisible } from './layout';
import { episodeProgress, episodeWatched, runtimeLabel, type Episode } from './info';

/** Cards mounted left of the first visible one, and right of the last. */
const MOUNT_BEFORE = 2;
const MOUNT_AFTER = 4;

export const episodeKey = (contentId: string) => `episode:${contentId}`;

function EpisodeCard({
  episode,
  autoFocus,
  onOpen,
  onFocused,
}: {
  episode: Episode;
  autoFocus: boolean;
  onOpen: () => void;
  onFocused: () => void;
}) {
  const t = useT();
  const url = useMediaUrl();
  const progress = episodeProgress(episode);
  const watched = episodeWatched(episode);
  const runtime = runtimeLabel(episode.runtime, t);
  const title = t('detail.episodeTitle', { number: episode.episode_number, title: episode.title });
  return (
    <CardFrame
      focusKey={episodeKey(episode.content_id)}
      variant="landscape"
      className="card-episode"
      autoFocus={autoFocus}
      onClick={onOpen}
      onFocused={onFocused}
      art={
        <>
          <Artwork src={url(episode.still_url)} thumbhash={episode.still_thumbhash} title={title} />
          {watched ? (
            <>
              <span className="episode-dim" aria-hidden="true" />
              <span
                className="episode-check"
                data-testid="episode-watched"
                role="img"
                aria-label={t('detail.watched')}
              >
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </>
          ) : null}
          {progress !== null ? (
            <span className="card-progress" aria-hidden="true">
              <span
                className="card-progress-fill"
                data-testid="card-progress"
                style={{ width: `${Math.round(progress * 1000) / 10}%` }}
              />
            </span>
          ) : null}
        </>
      }
      caption={
        <>
          <span className="card-title" data-testid="episode-title">
            {title}
          </span>
          <span className="card-sub" data-testid="episode-runtime">
            {runtime ?? ''}
          </span>
          <span className="episode-synopsis" data-testid="episode-synopsis">
            {episode.overview ?? ''}
          </span>
        </>
      }
    />
  );
}

/** The loading stand-in of the episode strip: cards of the same size, in the same slots. */
export function EpisodeStripSkeleton() {
  const cards = episodesVisible() + 1;
  return (
    <div
      className="detail-episode-strip"
      data-testid="episode-skeleton"
      aria-hidden="true"
      style={{ height: EPISODE_STRIP_HEIGHT }}
    >
      <div className="row-track" style={{ left: DETAIL_INSET }}>
        {Array.from({ length: cards }, (_, i) => (
          <div className="row-slot" key={i} style={{ left: i * EPISODE_STEP }}>
            <CardSkeleton shape="landscape" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The episodes of one season as a row of cards. The row scrolls with a transform so the focused
 * card stays on screen, only the cards near the viewport are mounted, and the focused card is
 * remembered (`memory` under `memoryId`) while another screen covers the page.
 */
export function EpisodeRow({
  episodes,
  memory,
  memoryId,
  initialIndex,
  autoFocusId,
  onAutoFocused,
  onOpen,
  onFocused,
}: {
  episodes: readonly Episode[];
  memory: FocusIndexMemory;
  memoryId: string;
  /** Where the focus lands first when the memory has nothing (the episode the page was opened on). */
  initialIndex: number;
  /** The episode that takes the focus when the strip appears (the one the page was opened on). */
  autoFocusId?: string;
  /** The strip has shown the episode that was to take the focus; it must not take it again. */
  onAutoFocused?: () => void;
  onOpen: (episode: Episode) => void;
  /** Any card got the focus (the page scrolls to this section). */
  onFocused: (episode: Episode) => void;
}) {
  const count = episodes.length;
  const visible = episodesVisible();
  const [focused, setFocused] = useState(() =>
    Math.min(memory.get(memoryId) ?? initialIndex, Math.max(0, count - 1)),
  );
  const [scroll, setScroll] = useState(() => nextScrollIndex(0, focused, visible, count));
  const effectiveScroll = nextScrollIndex(scroll, Math.min(focused, count - 1), visible, count);

  const focus = useCallback(
    (index: number, episode: Episode) => {
      setFocused(index);
      setScroll((current) => nextScrollIndex(current, index, visible, count));
      memory.set(memoryId, index);
      onFocused(episode);
    },
    [count, memory, memoryId, onFocused, visible],
  );

  // The cards claim the focus as they mount; this runs after them, once.
  useEffect(() => {
    if (autoFocusId && episodes.some((episode) => episode.content_id === autoFocusId)) {
      onAutoFocused?.();
    }
  }, [autoFocusId, episodes, onAutoFocused]);

  const focusedEpisode = episodes[Math.min(focused, count - 1)];
  const indices = mountedIndices(
    effectiveScroll,
    focused,
    visible,
    count,
    MOUNT_BEFORE,
    MOUNT_AFTER,
  );

  return (
    <FocusGroup
      focusKey={`detail-episodes-${memoryId}`}
      enterable
      saveLastFocusedChild
      // A strip that was unmounted and mounted again has forgotten its last focused card.
      preferredChildFocusKey={focusedEpisode ? episodeKey(focusedEpisode.content_id) : undefined}
      className="detail-episode-strip"
      style={{ height: EPISODE_STRIP_HEIGHT }}
      data-testid="episode-strip"
    >
      <div
        className="row-track"
        data-testid="row-track"
        style={{
          transform: `translateX(${-effectiveScroll * EPISODE_STEP}px)`,
          left: DETAIL_INSET,
        }}
      >
        {indices.map((index) => {
          const episode = episodes[index]!;
          return (
            <div
              className="row-slot"
              key={episode.content_id}
              style={{ left: index * EPISODE_STEP }}
            >
              <EpisodeCard
                episode={episode}
                autoFocus={episode.content_id === autoFocusId}
                onOpen={() => onOpen(episode)}
                onFocused={() => focus(index, episode)}
              />
            </div>
          );
        })}
      </div>
    </FocusGroup>
  );
}
