import { memo, useCallback, useMemo } from 'react';
import { useT } from '../../i18n';
import {
  protectsEpisodeStill,
  Row,
  useMediaUrl,
  useSpoilerSettings,
  type FocusIndexMemory,
} from '../../ui/media';
import { EpisodeCard } from './EpisodeCard';
import type { Episode } from './info';
import { DETAIL_INSET, EPISODE_ROW_CARD } from './layout';

const episodeId = (episode: Episode) => episode.content_id;

export const EPISODE_ROW_ID = 'more-episodes';

/**
 * "More Episodes" on an episode's page: a row of all the episodes of its season, like the web's
 * carousel. The episode whose page it is carries the "Now Viewing" mark, and the row starts on it:
 * it is in view and holds the focus when the row is entered for the first time. After that the row
 * remembers the card the focus was on (`memory`), also while another page covers this one.
 */
export const EpisodeRow = memo(function EpisodeRow({
  episodes,
  currentId,
  memory,
  onOpen,
  onPlay,
  onRowFocused,
}: {
  episodes: readonly Episode[];
  currentId: string;
  memory: FocusIndexMemory;
  onOpen: (episode: Episode) => void;
  onPlay: (episode: Episode) => void;
  /** Any card got the focus (the page scrolls to this row). */
  onRowFocused: () => void;
}) {
  const t = useT();
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  const artUrl = useCallback(
    (episode: Episode) => (protectsEpisodeStill(episode, spoilers) ? null : url(episode.still_url)),
    [spoilers, url],
  );
  const currentIndex = useMemo(
    () => episodes.findIndex((episode) => episode.content_id === currentId),
    [episodes, currentId],
  );
  const renderCard = useCallback(
    (episode: Episode, ctx: { focusKey: string; onFocused: () => void }) => (
      <EpisodeCard
        episode={episode}
        focusKey={ctx.focusKey}
        current={episode.content_id === currentId}
        onOpen={onOpen}
        onPlay={onPlay}
        onFocused={ctx.onFocused}
      />
    ),
    [currentId, onOpen, onPlay],
  );
  return (
    <Row
      rowId={EPISODE_ROW_ID}
      title={t('detail.moreEpisodes')}
      shape="landscape"
      metrics={EPISODE_ROW_CARD}
      items={episodes}
      getKey={episodeId}
      memory={memory}
      // A current episode that is not in the list (a stale list, -1) leaves the row on its first card.
      initialIndex={currentIndex}
      inset={DETAIL_INSET}
      artUrl={artUrl}
      onRowFocused={onRowFocused}
      renderCard={renderCard}
    />
  );
});
