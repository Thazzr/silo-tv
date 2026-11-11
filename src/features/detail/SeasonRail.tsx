import { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import { FocusGroup, focusFromPointer } from '../../app/nav';
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
import { seasonCountText, seasonLabel, seasonProgress, type Season } from './info';
import { DETAIL_INSET, SEASON_STEP, SEASON_STRIP_HEIGHT, seasonsVisible } from './layout';
import { onPlayKey } from './playKey';
import { SectionHead } from './SectionHead';

/** Cards mounted left of the first visible one, and right of the last. */
const MOUNT_BEFORE = 2;
const MOUNT_AFTER = 4;

/** Where the focus of the row is remembered while another screen covers the page. */
const MEMORY_ID = 'seasons';

const seasonKey = (season: number) => `season:${season}`;

function SeasonCard({
  season,
  onOpen,
  onPlay,
  onFocused,
}: {
  season: Season;
  onOpen: (season: Season) => void;
  onPlay: (season: Season) => void;
  onFocused: () => void;
}) {
  const t = useT();
  const url = useMediaUrl();
  const label = seasonLabel(season, t);
  const progress = seasonProgress(season);
  return (
    <CardFrame
      focusKey={seasonKey(season.season_number)}
      variant="poster"
      className="card-season"
      onClick={() => onOpen(season)}
      onFocused={onFocused}
      onKeyDown={onPlayKey(() => onPlay(season))}
      art={
        <>
          <Artwork src={url(season.poster_url)} thumbhash={season.poster_thumbhash} title={label} />
          {season.user_data?.played ? (
            <span
              className="season-check"
              data-testid="season-watched"
              role="img"
              aria-label={t('detail.watched')}
            >
              <Check size={22} strokeWidth={3} aria-hidden="true" />
            </span>
          ) : null}
          {progress !== null ? (
            <span className="card-progress" aria-hidden="true">
              <span
                className="card-progress-fill"
                data-testid="season-progress"
                style={{ width: `${Math.round(progress * 1000) / 10}%` }}
              />
            </span>
          ) : null}
        </>
      }
      caption={
        <>
          <span className="card-title" data-testid="season-label">
            {label}
          </span>
          <span className="card-sub" data-testid="season-count">
            {seasonCountText(season, t)}
          </span>
        </>
      }
    />
  );
}

/** The loading stand-in of the seasons row: the heading bar and poster cards in their slots. */
export function SeasonRailSkeleton() {
  const cards = seasonsVisible() + 1;
  return (
    <div className="detail-season-skeleton" data-testid="seasons-skeleton" aria-hidden="true">
      <div className="detail-section-head-skeleton" />
      <div className="detail-season-strip" style={{ height: SEASON_STRIP_HEIGHT }}>
        <div className="row-track" style={{ left: DETAIL_INSET }}>
          {Array.from({ length: cards }, (_, i) => (
            <div className="row-slot" key={i} style={{ left: i * SEASON_STEP }}>
              <CardSkeleton shape="poster" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The seasons of a series as a row of poster cards, the specials first, like the web's. OK opens a
 * season's page, the Play key plays what the season continues with. The row scrolls with a
 * transform so the focused card stays on screen, only the cards near the viewport are mounted,
 * and the focused card is remembered (`memory`) while another screen covers the page.
 */
export function SeasonRail({
  seasons,
  memory,
  onOpen,
  onPlay,
  onFocused,
}: {
  /** In display order. */
  seasons: readonly Season[];
  memory: FocusIndexMemory;
  onOpen: (season: Season) => void;
  onPlay: (season: Season) => void;
  /** Any card got the focus (the page scrolls to this section). */
  onFocused: () => void;
}) {
  const t = useT();
  const count = seasons.length;
  const visible = seasonsVisible();
  const [focused, setFocused] = useState(() =>
    Math.min(memory.get(MEMORY_ID) ?? 0, Math.max(0, count - 1)),
  );
  // The card the row last scrolled to; a hovered card does not move it (nav/origin.ts).
  const [scrolledTo, setScrolledTo] = useState(focused);
  const [scroll, setScroll] = useState(() => nextScrollIndex(0, focused, visible, count));
  const effectiveScroll = nextScrollIndex(scroll, scrolledTo, visible, count);

  const focus = useCallback(
    (index: number) => {
      setFocused(index);
      if (!focusFromPointer()) {
        setScrolledTo(index);
        setScroll((current) => nextScrollIndex(current, index, visible, count));
      }
      memory.set(MEMORY_ID, index);
      onFocused();
    },
    [count, memory, onFocused, visible],
  );

  const indices = mountedIndices(
    effectiveScroll,
    focused,
    visible,
    count,
    MOUNT_BEFORE,
    MOUNT_AFTER,
  );

  return (
    <>
      <SectionHead title={t('detail.seasons')} count={count} testId="seasons-head" />
      <FocusGroup
        focusKey="detail-seasons"
        enterable
        saveLastFocusedChild
        // A row that was unmounted and mounted again has forgotten its last focused card.
        preferredChildFocusKey={seasonKey(seasons[Math.min(focused, count - 1)]!.season_number)}
        className="detail-season-strip"
        style={{ height: SEASON_STRIP_HEIGHT }}
        data-testid="season-rail"
      >
        <div
          className="row-track"
          data-testid="season-track"
          style={{
            transform: `translateX(${-effectiveScroll * SEASON_STEP}px)`,
            left: DETAIL_INSET,
          }}
        >
          {indices.map((index) => {
            const season = seasons[index]!;
            return (
              <div
                className="row-slot"
                key={season.content_id}
                style={{ left: index * SEASON_STEP }}
              >
                <SeasonCard
                  season={season}
                  onOpen={onOpen}
                  onPlay={onPlay}
                  onFocused={() => focus(index)}
                />
              </div>
            );
          })}
        </div>
      </FocusGroup>
    </>
  );
}
