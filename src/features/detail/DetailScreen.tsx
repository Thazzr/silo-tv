import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { useBackHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { getPlatform } from '../../platform';
import { PersonCard, PosterCard, Row, keepAtOrigin, type CatalogItem } from '../../ui/media';
import type { BoxSetTarget } from '../boxset/boxSetMemory';
import { useBoxSetsAvailable } from '../library/queries';
import { resumePoint, type StartIntent } from '../../playback/resume';
import { useItemOpener } from '../home/useItemOpener';
import type { PersonTarget } from '../person/personMemory';
import { ActionRow, type EpisodeRef } from './ActionRow';
import { DetailBackdrop, DetailHero } from './DetailHero';
import { DetailSkeleton } from './DetailSkeleton';
import type { DetailEntryMemory, DetailTarget } from './detailMemory';
import { EpisodeRow, EpisodeStripSkeleton } from './EpisodeRow';
import { extraEntries } from './extras';
import { ExtrasRow } from './ExtrasRow';
import { defaultSeason, initials, orderSeasons, type Episode, type ItemDetail } from './info';
import {
  DETAIL_INSET,
  detailScrollOffset,
  isAbove,
  type DetailBlockTops,
  type DetailBlockZone,
  type DetailZone,
  SEASON_PILLS_GAP,
  SEASON_PILLS_HEIGHT,
} from './layout';
import { useItemBoxSet } from '../boxset/queries';
import {
  BOXSET_ROW_LIMIT,
  CAST_LIMIT,
  useItemDetail,
  useSeasonEpisodes,
  useSeasons,
  useSimilar,
} from './queries';
import { SeasonPills } from './SeasonPills';
import { SynopsisDialog } from './SynopsisDialog';
import { useThemeMusic } from './useThemeMusic';

/** What the player needs to start a title; an intent other than `ask` skips its resume prompt. */
export interface PlayRequest {
  contentId: string;
  title: string;
  intent?: StartIntent;
}

export interface DetailScreenProps {
  target: DetailTarget;
  /** What this visit remembers while the player (or another page) covers it. */
  memory: DetailEntryMemory;
  onPlay: (request: PlayRequest) => void;
  /** Opens another title's page over this one ("More like this"). */
  onOpenDetail: (target: DetailTarget) => void;
  /** Opens a cast member's page over this one. */
  onOpenPerson: (target: PersonTarget) => void;
  /** Opens a box set's page over this one (a movie's box set row). */
  onOpenBoxSet: (target: BoxSetTarget) => void;
  onBack: () => void;
}

const BLOCK_ZONES: readonly DetailBlockZone[] = ['episodes', 'cast', 'extras', 'boxSet', 'similar'];

/** How long a short notice (YouTube is not available) stays on the page. */
const NOTICE_MS = 4000;

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
  onOpenPerson,
  onOpenBoxSet,
}: DetailScreenProps & { detail: ItemDetail }) {
  const t = useT();
  const series = isSeries(detail);
  const seriesId = detail.content_id;
  // The title's theme song plays while this page is the screen on top.
  useThemeMusic(detail);

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

  const play = (intent: StartIntent) => {
    if (playId) onPlay({ contentId: playId, title: detail.title, intent });
  };

  // --- Season switch: a season shows only when its pill is activated (OK or a click) -------------
  const selectSeason = useCallback(
    (season: number) => {
      memory.pickSeason(season);
      setPicked(season);
      // Choosing a season ends the page's own claim on the focus.
      setOpenedOn(undefined);
    },
    [memory],
  );

  // --- More like this ---------------------------------------------------------------------------
  const similar = useSimilar(detail.content_id, true);
  const playItem = useCallback(
    (item: CatalogItem, intent?: StartIntent) =>
      onPlay({ contentId: item.content_id, title: item.title, intent }),
    [onPlay],
  );
  const { open: openSimilar } = useItemOpener({ onPlay: playItem, onOpenDetail });
  const similarItems = similar.data ?? [];

  // --- Cast -------------------------------------------------------------------------------------
  const cast = useMemo(
    () => [...detail.cast].sort((a, b) => a.order - b.order).slice(0, CAST_LIMIT),
    [detail.cast],
  );
  // --- Trailer & More ---------------------------------------------------------------------------
  // Local extras, then YouTube videos. Only movies and series own any, so the page just reads
  // what the detail carries.
  const extras = useMemo(() => extraEntries(detail), [detail]);
  const extrasBackdrop = useMemo(
    () => ({ url: detail.backdrop_url, thumbhash: detail.backdrop_thumbhash }),
    [detail.backdrop_url, detail.backdrop_thumbhash],
  );
  const playExtra = useCallback(
    (contentId: string, caption: string) =>
      onPlay({ contentId, title: caption, intent: { kind: 'beginning' } }),
    [onPlay],
  );
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const openYouTube = useCallback(
    (videoId: string) => {
      void getPlatform()
        .openYouTubeVideo(videoId)
        .then((result) => {
          if (result === 'unavailable') setNotice(t('extras.youtubeUnavailable'));
        });
    },
    [t],
  );

  // --- The box set of a movie ---------------------------------------------------------------------
  // Only a movie, and only on a server that has box sets; a movie in none (or a failed read) has
  // no row. The detail carries no library, so the server picks the movie's own.
  const boxSetsAvailable = useBoxSetsAvailable();
  const boxSetQuery = useItemBoxSet(detail.content_id, undefined, !series && boxSetsAvailable);
  const boxSet = !series && boxSetsAvailable ? (boxSetQuery.data ?? null) : null;
  const boxSetFilms = useMemo(() => boxSet?.items.slice(0, BOXSET_ROW_LIMIT) ?? [], [boxSet]);
  const openBoxSet = useCallback(() => {
    if (!boxSet) return;
    onOpenBoxSet({
      boxSetId: boxSet.id,
      libraryId: boxSet.library_id,
      boxSetTitle: boxSet.title,
      backdropUrl: boxSet.backdrop_url,
    });
  }, [boxSet, onOpenBoxSet]);
  const openBoxSetFilm = useCallback(
    (item: CatalogItem) => {
      // The film on screen is the one this page shows: OK on it does nothing.
      if (item.content_id !== detail.content_id) openSimilar(item);
    },
    [detail.content_id, openSimilar],
  );

  // --- Vertical scroll: the page moves to the section that holds the focus ----------------------
  const [zone, setZone] = useState<DetailZone>('hero');
  // The tops of the blocks below the hero are measured, not assumed: a tall hero (logo, four lines
  // of synopsis, credits) pushes them down, and fonts or a longer synopsis change them later.
  const pageRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<DetailBlockTops>({});
  const measure = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    const next: DetailBlockTops = {};
    for (const block of BLOCK_ZONES) {
      const el = page.querySelector<HTMLElement>(`[data-zone="${block}"]`);
      if (el) next[block] = el.offsetTop;
    }
    setTops((old) => (BLOCK_ZONES.every((block) => old[block] === next[block]) ? old : next));
  }, []);
  // Which blocks exist below the hero: the observer is attached once per such set, and the tops
  // are measured when it changes (blocks appear as their data arrives).
  const blockSet = [
    series ? 'episodes' : cast.length > 0 ? 'cast' : '',
    extras.length > 0 ? 'extras' : '',
    boxSetFilms.length > 0 ? 'boxSet' : '',
    similarItems.length > 0 ? 'similar' : '',
  ].join('|');
  useLayoutEffect(() => {
    measure();
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === 'undefined') return;
    // Whenever a box changes size (fonts, a longer synopsis, the logo): measure again.
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    page.querySelectorAll('[data-zone], .detail-hero').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [measure, blockSet]);
  const offset = detailScrollOffset(zone, tops);
  const fade = (block: DetailZone) => (isAbove(block, zone) ? 'true' : 'false');
  const inHero = useCallback(() => setZone('hero'), []);
  const inEpisodes = useCallback(() => setZone('episodes'), []);
  const inCast = useCallback(() => setZone('cast'), []);
  const inExtras = useCallback(() => setZone('extras'), []);
  const inBoxSet = useCallback(() => setZone('boxSet'), []);
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
          onPick={selectSeason}
          onFocused={inEpisodes}
        />
      );
    }
    episodeBlock = (
      <section
        className="detail-section detail-episodes"
        data-testid="detail-episodes"
        data-zone="episodes"
        data-faded={fade('episodes')}
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
    <>
      <main
        className="detail"
        data-testid="detail"
        data-type={detail.type}
        data-transform-scrolled="page"
        onScroll={keepAtOrigin}
      >
        <DetailBackdrop detail={detail} scrolled={zone !== 'hero'} />
        <div
          ref={pageRef}
          className="detail-page"
          style={{ transform: `translateY(${-offset}px)` }}
        >
          <DetailHero
            detail={detail}
            faded={fade('hero') === 'true'}
            onMore={() => setSynopsisOpen(true)}
            actions={
              playId ? (
                <ActionRow
                  resumeSeconds={resumeSeconds}
                  episode={series ? episodeRef : undefined}
                  autoFocus={openedOn === undefined}
                  onPlay={() => play({ kind: stateKnown ? 'beginning' : 'ask' })}
                  onResume={() => play({ kind: 'resume' })}
                  onStartOver={() => play({ kind: 'beginning' })}
                  onFocused={inHero}
                />
              ) : null
            }
          />
          {episodeBlock}
          {!series && cast.length > 0 ? (
            <div data-zone="cast" data-faded={fade('cast')}>
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
                    onOpen={() => {
                      // A credit without a person id has no page to open.
                      if (person.person_id) {
                        onOpenPerson({ personId: person.person_id, personName: person.name });
                      }
                    }}
                  />
                )}
              />
            </div>
          ) : null}
          {extras.length > 0 ? (
            <div data-zone="extras" data-faded={fade('extras')}>
              <ExtrasRow
                entries={extras}
                backdrop={extrasBackdrop}
                memory={memory.rows}
                onRowFocused={inExtras}
                onPlayExtra={playExtra}
                onOpenYouTube={openYouTube}
              />
            </div>
          ) : null}
          {boxSet && boxSetFilms.length > 0 ? (
            <div data-zone="boxSet" data-faded={fade('boxSet')}>
              <Row
                rowId="boxset"
                title={boxSet.title}
                shape="poster"
                items={boxSetFilms}
                getKey={(item) => item.content_id}
                memory={memory.rows}
                inset={DETAIL_INSET}
                onRowFocused={inBoxSet}
                onExploreAll={openBoxSet}
                renderCard={(item, ctx) => (
                  <PosterCard
                    item={item}
                    focusKey={ctx.focusKey}
                    onFocused={ctx.onFocused}
                    onOpen={openBoxSetFilm}
                    badge={item.content_id === detail.content_id ? t('boxset.thisFilm') : undefined}
                  />
                )}
              />
            </div>
          ) : null}
          {similarItems.length > 0 ? (
            <div data-zone="similar" data-faded={fade('similar')}>
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
            </div>
          ) : null}
        </div>
        {notice ? (
          <p className="detail-notice" role="status" data-testid="detail-notice">
            {notice}
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
    </>
  );
}
