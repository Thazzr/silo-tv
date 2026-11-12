import { useCallback, type CSSProperties } from 'react';
import {
  CardSkeleton,
  Grid,
  protectsEpisodeStill,
  useMediaUrl,
  useSpoilerSettings,
  type FocusIndexMemory,
  type GridCardContext,
} from '../../ui/media';
import { EpisodeCard } from './EpisodeCard';
import type { Episode } from './info';
import { EPISODE_GRID } from './layout';

const noop = () => undefined;
const episodeId = (episode: Episode) => episode.content_id;

/** Rows the loading stand-in draws. */
const SKELETON_ROWS = 2;

/** The loading stand-in of the episode grid: stills of the same size, in the same slots. */
export function EpisodeGridSkeleton() {
  const { columns, rowPitch, card, gap, inset } = EPISODE_GRID;
  const step = card.width + gap;
  return (
    <div
      className="detail-episode-grid"
      data-testid="episode-skeleton"
      aria-hidden="true"
      style={gridHeight(SKELETON_ROWS)}
    >
      <div className="grid-viewport">
        <div className="grid-track" style={{ left: inset, height: SKELETON_ROWS * rowPitch }}>
          {Array.from({ length: SKELETON_ROWS * columns }, (_, i) => (
            <div
              className="grid-slot"
              key={i}
              style={{ left: (i % columns) * step, top: Math.floor(i / columns) * rowPitch }}
            >
              <CardSkeleton shape="landscape" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The grid is as tall as its rows, but never taller than what is left of the screen. */
function gridHeight(rows: number): CSSProperties {
  return { '--grid-rows-height': `${rows * EPISODE_GRID.rowPitch + 14}px` } as CSSProperties;
}

/**
 * The episodes of a season as a grid of stills, five across, like the web's. OK opens an episode's
 * page, the Play key plays it. Only the rows near the viewport are mounted; the grid scrolls with a
 * transform, and the focused card is remembered (`memory` under `gridId`) while another screen
 * covers the page.
 */
export function EpisodeGrid({
  gridId,
  episodes,
  memory,
  onOpen,
  onPlay,
  onFocused,
}: {
  gridId: string;
  episodes: readonly Episode[];
  memory: FocusIndexMemory;
  onOpen: (episode: Episode) => void;
  onPlay: (episode: Episode) => void;
  /** Any card got the focus (the page scrolls to this section). */
  onFocused: () => void;
}) {
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  // The picture ahead of the focus is fetched, unless it is a protected still.
  const artUrl = useCallback(
    (episode: Episode) => (protectsEpisodeStill(episode, spoilers) ? null : url(episode.still_url)),
    [spoilers, url],
  );
  const renderCard = useCallback(
    (episode: Episode, ctx: GridCardContext) => (
      <EpisodeCard
        episode={episode}
        focusKey={ctx.focusKey}
        onOpen={onOpen}
        onPlay={onPlay}
        onFocused={() => {
          ctx.onFocused();
          onFocused();
        }}
      />
    ),
    [onOpen, onPlay, onFocused],
  );
  return (
    <div
      className="detail-episode-grid"
      data-testid="episode-grid"
      style={gridHeight(Math.ceil(episodes.length / EPISODE_GRID.columns))}
    >
      <Grid
        gridId={gridId}
        items={episodes}
        getKey={episodeId}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
        memory={memory}
        artUrl={artUrl}
        layout={EPISODE_GRID}
        // A row that has scrolled out must not show its captions at the top of the viewport.
        hideRowsAbove
        renderCard={renderCard}
      />
    </div>
  );
}
