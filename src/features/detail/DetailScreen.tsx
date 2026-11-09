import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { FocusTrackerContext, useBackHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import {
  PersonCard,
  PosterCard,
  Row,
  keepAtOrigin,
  rowHeight,
  type CatalogItem,
} from '../../ui/media';
import { useItemOpener } from '../home/useItemOpener';
import { ActionRow, type EpisodeRef } from './ActionRow';
import { DetailHero } from './DetailHero';
import { DetailSkeleton } from './DetailSkeleton';
import type { DetailEntryMemory, DetailTarget } from './detailMemory';
import { EpisodeRow, EpisodeStripSkeleton } from './EpisodeRow';
import {
  defaultSeason,
  initials,
  orderSeasons,
  resumePoint,
  type Episode,
  type ItemDetail,
} from './info';
import {
  DETAIL_INSET,
  EPISODES_SECTION_HEIGHT,
  HERO_HEIGHT,
  SECTION_TOP_MARGIN,
  SEASON_PILLS_GAP,
  SEASON_PILLS_HEIGHT,
} from './layout';
import { CAST_LIMIT, useItemDetail, useSeasonEpisodes, useSeasons, useSimilar } from './queries';
import { SeasonPills, isSeasonKey } from './SeasonPills';
import { SynopsisDialog } from './SynopsisDialog';

/** How long the focus must rest on a season pill before its episodes replace the shown ones. */
export const SEASON_SWITCH_DELAY_MS = 300;
/** How long "Person pages come soon" stays on screen. */
const NOTE_MS = 4000;

/** What the player needs to start a title; `startPosition` skips its resume prompt. */
export interface PlayRequest {
  contentId: string;
  title: string;
  startPosition?: number;
}

export interface DetailScreenProps {
  target: DetailTarget;
  /** What this visit remembers while the player (or another page) covers it. */
  memory: DetailEntryMemory;
  onPlay: (request: PlayRequest) => void;
  /** Opens another title's page over this one ("More like this"). */
  onOpenDetail: (target: DetailTarget) => void;
  onBack: () => void;
  /** How long the focus rests on a season pill before the season changes; tests shorten it. */
  switchDelayMs?: number;
}

/** The sections of the page the view scrolls between. */
type Zone = 'hero' | 'episodes' | 'cast' | 'similar';

const isSeries = (detail: ItemDetail) => detail.type.trim().toLowerCase() === 'series';

/**
 * The detail page of a movie or a series: hero with the primary actions, then the seasons and
 * episodes of a series or the cast of a movie, then "More like this". The page loads its item
 * first (a skeleton shaped like the page stands in); a title that is gone shows a message with
 * Back, any other failure offers Try again. It is read again whenever it shows again, so the
 * buttons follow what the player changed.
 */
export function DetailScreen(props: DetailScreenProps) {
  const t = useT();
  const detail = useItemDetail(props.target.itemId);

  if (detail.data)
    return <DetailBody key={detail.data.content_id} detail={detail.data} {...props} />;

  let body;
  if (detail.isPending) {
    body = <DetailSkeleton />;
  } else {
    const gone = detail.error instanceof SiloApiError && detail.error.status === 404;
    body = (
      <div
        className="detail-message"
        role="alert"
        data-testid={gone ? 'detail-gone' : 'detail-error'}
      >
        <p className="error">{t(gone ? 'detail.gone' : 'detail.error')}</p>
        <Button
          focusKey="detail-retry"
          autoFocus
          onClick={gone ? props.onBack : () => void detail.refetch()}
        >
          {t(gone ? 'detail.goneBack' : 'common.retry')}
        </Button>
      </div>
    );
  }
  return (
    <main className="detail" data-testid="detail">
      {body}
    </main>
  );
}

function DetailBody({
  detail,
  target,
  memory,
  onPlay,
  onOpenDetail,
  switchDelayMs = SEASON_SWITCH_DELAY_MS,
}: DetailScreenProps & { detail: ItemDetail }) {
  const t = useT();
  const series = isSeries(detail);
  const seriesId = detail.content_id;

  const [synopsisOpen, setSynopsisOpen] = useState(false);
  // Back closes the synopsis first; without a handler it leaves the page.
  useBackHandler(synopsisOpen ? () => setSynopsisOpen(false) : undefined);

  // The card the page was opened on takes the focus once; later season changes must not steal it.
  const [openedOn, setOpenedOn] = useState(target.episodeId);
  const clearOpenedOn = useCallback(() => setOpenedOn(undefined), []);

  // --- Seasons and episodes --------------------------------------------------------------------
  const seasonsQuery = useSeasons(seriesId, series);
  const seasons = useMemo(() => orderSeasons(seasonsQuery.data ?? []), [seasonsQuery.data]);
  const [picked, setPicked] = useState<number | undefined>(memory.season);
  const wanted = picked ?? target.season ?? detail.play_season_number;
  const seasonKnown = seasons.some((season) => season.season_number === wanted);
  // A season the server does not list (or none given) falls back to the first one.
  const shown = !series
    ? undefined
    : wanted !== undefined && (seasonsQuery.isPending || seasonKnown)
      ? wanted
      : defaultSeason(seasons);
  const episodesQuery = useSeasonEpisodes(seriesId, shown);
  const episodes = episodesQuery.data;

  // The episode "Play" plays: the one the page was opened on, else the server's play target.
  const targetId = series ? (target.episodeId ?? detail.play_content_id) : undefined;
  const explicitSeason = target.episodeId !== undefined ? target.season : detail.play_season_number;
  const primarySeason = series ? (explicitSeason ?? defaultSeason(seasons)) : undefined;
  const primaryQuery = useSeasonEpisodes(seriesId, primarySeason);
  const primaryEpisode: Episode | undefined = series
    ? targetId
      ? primaryQuery.data?.find((episode) => episode.content_id === targetId)
      : primaryQuery.data?.[0]
    : undefined;

  const playId = series ? (targetId ?? primaryEpisode?.content_id) : detail.content_id;
  // Whether the watch state of what plays is known; before that the player asks itself.
  const stateKnown = series ? primaryEpisode !== undefined : true;
  const watchState = series ? primaryEpisode?.user_data : detail.user_data;
  const runtimeSeconds = (series ? primaryEpisode?.runtime : detail.runtime) ?? 0;
  const resumeSeconds = stateKnown
    ? resumePoint(watchState, detail.duration_seconds ?? runtimeSeconds * 60)
    : null;
  const episodeRef: EpisodeRef | undefined = primaryEpisode
    ? { season: primaryEpisode.season_number, episode: primaryEpisode.episode_number }
    : undefined;

  const play = (startPosition: number | undefined) => {
    if (playId) onPlay({ contentId: playId, title: detail.title, startPosition });
  };

  // --- Season switch: a pill that keeps the focus shows its season after a short rest -----------
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });
  const clearPending = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  }, []);
  useEffect(() => clearPending, [clearPending]);
  const selectSeason = useCallback(
    (season: number) => {
      clearPending();
      memory.pickSeason(season);
      setPicked(season);
      // Choosing a season ends the page's own claim on the focus.
      setOpenedOn(undefined);
    },
    [clearPending, memory],
  );
  const seasonFocused = useCallback(
    (season: number) => {
      clearPending();
      if (season === shownRef.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        selectSeason(season);
      }, switchDelayMs);
    },
    [clearPending, selectSeason, switchDelayMs],
  );
  // Down into the episodes before the delay ran out: the season that is shown stays.
  const report = useCallback(
    (focusKey: string) => {
      if (!isSeasonKey(focusKey)) clearPending();
    },
    [clearPending],
  );

  // --- More like this ---------------------------------------------------------------------------
  const similar = useSimilar(detail.content_id, true);
  const playItem = useCallback(
    (item: CatalogItem) => onPlay({ contentId: item.content_id, title: item.title }),
    [onPlay],
  );
  const { open: openSimilar } = useItemOpener({ onPlay: playItem, onOpenDetail });
  const similarItems = similar.data ?? [];

  // --- Cast -------------------------------------------------------------------------------------
  const cast = useMemo(
    () => [...detail.cast].sort((a, b) => a.order - b.order).slice(0, CAST_LIMIT),
    [detail.cast],
  );
  const [personNote, setPersonNote] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    },
    [],
  );
  // The person page comes with P2.4; until then OK on a person says so.
  const openPerson = () => {
    setPersonNote(true);
    if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setPersonNote(false), NOTE_MS);
  };

  // --- Vertical scroll: the page moves to the section that holds the focus ----------------------
  const [zone, setZone] = useState<Zone>('hero');
  const sections: { zone: Zone; height: number }[] = [];
  if (series) sections.push({ zone: 'episodes', height: EPISODES_SECTION_HEIGHT });
  else if (cast.length > 0) sections.push({ zone: 'cast', height: rowHeight('poster') });
  if (similarItems.length > 0) sections.push({ zone: 'similar', height: rowHeight('poster') });
  let offset = 0;
  if (zone !== 'hero') {
    let top = HERO_HEIGHT;
    for (const section of sections) {
      if (section.zone === zone) break;
      top += section.height;
    }
    offset = top - SECTION_TOP_MARGIN;
  }
  const inHero = useCallback(() => setZone('hero'), []);
  const inEpisodes = useCallback(() => setZone('episodes'), []);
  const inCast = useCallback(() => setZone('cast'), []);
  const inSimilar = useCallback(() => setZone('similar'), []);

  const openedIndex = episodes?.findIndex((episode) => episode.content_id === openedOn) ?? -1;

  let episodeBlock = null;
  if (series) {
    let strip;
    if (episodesQuery.isError && !episodes) {
      strip = (
        <div className="detail-section-message" role="alert" data-testid="episodes-error">
          <p className="error">{t('detail.episodesError')}</p>
          <Button
            focusKey="detail-episodes-retry"
            onFocused={inEpisodes}
            onClick={() => void episodesQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      );
    } else if (!episodes) {
      strip = <EpisodeStripSkeleton />;
    } else if (episodes.length === 0) {
      strip = (
        <p className="note detail-section-message" data-testid="episodes-empty">
          {t('detail.episodesEmpty')}
        </p>
      );
    } else {
      strip = (
        <EpisodeRow
          key={shown}
          episodes={episodes}
          memory={memory.rows}
          memoryId={`season-${shown}`}
          initialIndex={Math.max(0, openedIndex)}
          autoFocusId={openedOn}
          onAutoFocused={clearOpenedOn}
          onOpen={(episode) => onPlay({ contentId: episode.content_id, title: detail.title })}
          onFocused={inEpisodes}
        />
      );
    }
    let pills;
    if (seasonsQuery.isError && !seasonsQuery.data) {
      pills = (
        <div className="detail-section-message" role="alert" data-testid="seasons-error">
          <p className="error">{t('detail.seasonsError')}</p>
          <Button
            focusKey="detail-seasons-retry"
            onFocused={inEpisodes}
            onClick={() => void seasonsQuery.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      );
    } else if (seasonsQuery.isPending) {
      pills = (
        <div
          className="detail-seasons-skeleton"
          aria-hidden="true"
          data-testid="seasons-skeleton"
        />
      );
    } else {
      pills = (
        <SeasonPills
          seasons={seasons}
          selected={shown}
          onFocusSeason={seasonFocused}
          onPick={selectSeason}
          onFocused={inEpisodes}
        />
      );
    }
    episodeBlock = (
      <section
        className="detail-section detail-episodes"
        data-testid="detail-episodes"
        style={{ height: EPISODES_SECTION_HEIGHT }}
      >
        <div
          className="detail-pills-box"
          style={{ height: SEASON_PILLS_HEIGHT, marginBottom: SEASON_PILLS_GAP }}
        >
          {pills}
        </div>
        {strip}
      </section>
    );
  }

  return (
    <FocusTrackerContext.Provider value={report}>
      <main className="detail" data-testid="detail" data-type={detail.type} onScroll={keepAtOrigin}>
        <div className="detail-page" style={{ transform: `translateY(${-offset}px)` }}>
          <DetailHero
            detail={detail}
            onMore={() => setSynopsisOpen(true)}
            actions={
              playId ? (
                <ActionRow
                  resumeSeconds={resumeSeconds}
                  episode={series ? episodeRef : undefined}
                  autoFocus={openedOn === undefined}
                  onPlay={() => play(stateKnown ? 0 : undefined)}
                  onResume={() => play(resumeSeconds ?? undefined)}
                  onStartOver={() => play(0)}
                  onFocused={inHero}
                />
              ) : null
            }
          />
          {episodeBlock}
          {!series && cast.length > 0 ? (
            <Row
              rowId="cast"
              title={t('detail.cast')}
              shape="poster"
              items={cast}
              getKey={(person) => person.person_id ?? `${person.order}-${person.name}`}
              memory={memory.rows}
              inset={DETAIL_INSET}
              onRowFocused={inCast}
              renderCard={(person, ctx) => (
                <PersonCard
                  name={person.name}
                  role={person.character}
                  photo={person.photo_url}
                  thumbhash={person.photo_thumbhash}
                  initials={initials(person.name)}
                  focusKey={ctx.focusKey}
                  onFocused={ctx.onFocused}
                  onOpen={openPerson}
                />
              )}
            />
          ) : null}
          {similarItems.length > 0 ? (
            <Row
              rowId="similar"
              title={t('detail.similar')}
              shape="poster"
              items={similarItems}
              getKey={(item) => item.content_id}
              memory={memory.rows}
              inset={DETAIL_INSET}
              onRowFocused={inSimilar}
              renderCard={(item, ctx) => (
                <PosterCard
                  item={item}
                  focusKey={ctx.focusKey}
                  onFocused={ctx.onFocused}
                  onOpen={openSimilar}
                />
              )}
            />
          ) : null}
        </div>
        {personNote ? (
          <p role="status" className="note toast" data-testid="person-note">
            {t('detail.personSoon')}
          </p>
        ) : null}
        {synopsisOpen && detail.overview ? (
          <SynopsisDialog
            title={detail.title}
            text={detail.overview}
            onClose={() => setSynopsisOpen(false)}
          />
        ) : null}
      </main>
    </FocusTrackerContext.Provider>
  );
}
