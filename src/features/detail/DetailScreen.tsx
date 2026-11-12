import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { focusFromPointer, getCurrentFocusKey, moveFocusTo, useBackHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { getPlatform } from '../../platform';
import {
  PersonCard,
  PosterCard,
  Row,
  cardFocusKey,
  keepAtOrigin,
  protectsEpisodeOverview,
  useSpoilerSettings,
  type CatalogItem,
} from '../../ui/media';
import type { BoxSetTarget } from '../boxset/boxSetMemory';
import { useBoxSetsAvailable } from '../library/queries';
import { resumePoint, type StartIntent } from '../../playback/resume';
import { useItemOpener } from '../home/useItemOpener';
import type { PersonTarget } from '../person/personMemory';
import { ActionRow, PLAY_KEY, TRANSLATE_KEY } from './ActionRow';
import { DetailBackdrop, DetailHero } from './DetailHero';
import { DetailSkeleton } from './DetailSkeleton';
import type { DetailEntryMemory, DetailTarget } from './detailMemory';
import { EpisodeGrid, EpisodeGridSkeleton } from './EpisodeGrid';
import { EPISODE_ROW_ID, EpisodeRow } from './EpisodeRow';
import { extraEntries } from './extras';
import { ExtrasRow } from './ExtrasRow';
import {
  defaultSeason,
  detailKind,
  heroSynopsis,
  initials,
  orderSeasons,
  seasonLabel,
  type Episode,
  type ItemDetail,
  type Season,
} from './info';
import {
  DETAIL_INSET,
  detailScrollOffset,
  isAbove,
  type DetailBlockTops,
  type DetailBlockZone,
  type DetailZone,
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
import { SeasonRail, SeasonRailSkeleton } from './SeasonRail';
import { SectionHead } from './SectionHead';
import { SynopsisDialog } from './SynopsisDialog';
import { useDescriptionTranslation } from './useDescriptionTranslation';
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

const BLOCK_ZONES: readonly DetailBlockZone[] = [
  'seasons',
  'episodes',
  'cast',
  'extras',
  'boxSet',
  'similar',
];

/** How long a short notice (YouTube is not available) stays on the page. */
const NOTICE_MS = 4000;

/**
 * The detail page of any title, like the web's one route for every type: hero with the primary
 * actions, then the seasons of a series (or, with one season, its episodes), the episodes of a
 * season, or the cast of a movie, then "More like this". The page loads its item first (a skeleton
 * shaped like the page stands in) and lays itself out by the item's type; a title that is gone
 * shows a message with Back, any other failure offers Try again. It is read again whenever it
 * shows again, so the buttons follow what the player changed.
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
  const kind = detailKind(detail);
  const series = kind === 'series';
  const season = kind === 'season';
  const episode = kind === 'episode';
  // The title the player shows for any episode played from this page: the series'.
  const playTitle = season || episode ? (detail.series_title ?? detail.title) : detail.title;
  // A season page lists the episodes of its own season of its series; an episode page lists the
  // same ones as its siblings ("More Episodes").
  const parent =
    (season || episode) && detail.series_id !== undefined && detail.season_number !== undefined
      ? { seriesId: detail.series_id, number: detail.season_number }
      : undefined;
  const seriesId = parent?.seriesId ?? detail.content_id;
  // The title's theme song plays while this page is the screen on top.
  useThemeMusic(detail);

  const [synopsisOpen, setSynopsisOpen] = useState(false);
  // Back closes the synopsis first; without a handler it leaves the page.
  useBackHandler(synopsisOpen ? () => setSynopsisOpen(false) : undefined);

  // --- Seasons and episodes --------------------------------------------------------------------
  // An episode page reads the season list for its season's label in the breadcrumb.
  const seasonsQuery = useSeasons(seriesId, series || (episode && parent !== undefined));
  const seasons = useMemo(() => orderSeasons(seasonsQuery.data ?? []), [seasonsQuery.data]);
  // A series with exactly one season has no seasons row: its episodes are listed on its own page.
  const singleSeason: Season | undefined = series && seasons.length === 1 ? seasons[0] : undefined;
  const listedNumber = parent?.number ?? singleSeason?.season_number;
  const listedId = season ? detail.content_id : singleSeason?.content_id;
  const episodesQuery = useSeasonEpisodes(seriesId, listedNumber);
  const episodes = episodesQuery.data;

  // The episode "Play" plays: a series' target (the server's), else the first of its play season;
  // a season's first listed episode.
  const targetId = series ? detail.play_content_id : undefined;
  const primarySeason = series ? (detail.play_season_number ?? defaultSeason(seasons)) : undefined;
  const primaryQuery = useSeasonEpisodes(seriesId, primarySeason);
  let primaryEpisode: Episode | undefined;
  if (series) {
    primaryEpisode = targetId
      ? primaryQuery.data?.find((episode) => episode.content_id === targetId)
      : primaryQuery.data?.[0];
  } else if (season) {
    primaryEpisode = episodes?.[0];
  }

  const playId =
    kind === 'item' || episode ? detail.content_id : (targetId ?? primaryEpisode?.content_id);
  // Whether the watch state of what plays is known; before that the player asks itself. A season
  // always plays from the start, so it needs none.
  const stateKnown = series ? primaryEpisode !== undefined : true;
  const watchState = series ? primaryEpisode?.user_data : detail.user_data;
  const runtimeSeconds = (series ? primaryEpisode?.runtime : detail.runtime) ?? 0;
  const fallbackSeconds = detail.duration_seconds ?? runtimeSeconds * 60;
  const resumeSeconds = stateKnown ? resumePoint(watchState, fallbackSeconds) : null;
  const totalSeconds = watchState?.duration_seconds || fallbackSeconds;
  // A series whose target episode is still being looked up has no action row yet (the primary
  // button would flicker from "Browse series" to its label); a season waits for its first episode.
  // An episode without a file has nothing to play.
  const playable = episode ? detail.versions.length > 0 : playId !== undefined;
  const resolvingTarget = season
    ? episodesQuery.isLoading
    : series &&
      playId === undefined &&
      (seasonsQuery.isPending || (primarySeason !== undefined && primaryQuery.isPending));

  const play = (intent: StartIntent) => {
    if (playId) onPlay({ contentId: playId, title: playTitle, intent });
  };

  // --- Opening and playing the cards of the seasons row and the episode grid ---------------------
  const openSeason = useCallback(
    (card: Season) => onOpenDetail({ itemId: card.content_id }),
    [onOpenDetail],
  );
  const playSeason = useCallback(
    (card: Season) => {
      if (card.play_content_id) {
        onPlay({ contentId: card.play_content_id, title: playTitle, intent: { kind: 'ask' } });
      }
    },
    [onPlay, playTitle],
  );
  const openEpisode = useCallback(
    (episode: Episode) => onOpenDetail({ itemId: episode.content_id }),
    [onOpenDetail],
  );
  // OK on the card of the episode on screen does nothing, as on a box set's "this film" card.
  const openSibling = useCallback(
    (card: Episode) => {
      // The page of a sibling starts in the row, so the viewer can walk on through the season.
      if (card.content_id !== detail.content_id) {
        onOpenDetail({ itemId: card.content_id, startInRow: true });
      }
    },
    [detail.content_id, onOpenDetail],
  );
  const playEpisode = useCallback(
    (episode: Episode) =>
      onPlay({ contentId: episode.content_id, title: playTitle, intent: { kind: 'ask' } }),
    [onPlay, playTitle],
  );

  // --- The synopsis -------------------------------------------------------------------------------
  // An episode without a description of its own shows its series': the series is read for that.
  const spoilers = useSpoilerSettings();
  const seriesQuery = useItemDetail(
    detail.series_id ?? '',
    episode && !detail.overview && detail.series_id !== undefined,
  );
  const synopsis = useMemo(
    () =>
      heroSynopsis(
        detail,
        seriesQuery.data?.overview,
        episode && protectsEpisodeOverview(detail, spoilers),
      ),
    [detail, episode, seriesQuery.data?.overview, spoilers],
  );

  // --- AI translation of the descriptions ----------------------------------------------------------
  const listed = useMemo(
    () =>
      listedId !== undefined && listedNumber !== undefined
        ? { id: listedId, number: listedNumber }
        : undefined,
    [listedId, listedNumber],
  );
  const translation = useDescriptionTranslation({
    itemId: target.itemId,
    detail,
    seriesId,
    listed,
    episodes,
  });
  const translateShown = translation.showPill && playId !== undefined;
  // The pill goes while a run is under way; the focus never ends up on nothing.
  useEffect(() => {
    if (!translateShown && getCurrentFocusKey() === TRANSLATE_KEY) moveFocusTo(PLAY_KEY);
  }, [translateShown]);
  // The series' description (shown for an episode without one) is not what was translated here.
  const translationLine = synopsis.fromSeries
    ? null
    : translation.itemRunning
      ? 'translating'
      : detail.machine_translated_fields?.includes('overview')
        ? 'ai'
        : null;

  // --- More like this ---------------------------------------------------------------------------
  // Only a movie and a series have such a row, as on the web.
  const similar = useSimilar(detail.content_id, kind === 'item' || series);
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
  // Only a movie has a box set.
  const isMovie = detail.type.trim().toLowerCase() === 'movie';
  const boxSetQuery = useItemBoxSet(detail.content_id, undefined, isMovie && boxSetsAvailable);
  const boxSet = boxSetQuery.data ?? null;
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
  const offset = detailScrollOffset(zone, tops);
  const fade = (block: DetailZone) => (isAbove(block, zone) ? 'true' : 'false');
  // A hovered element keeps the page where it is (nav/origin.ts): only keys change the zone.
  const enter = useCallback((next: DetailZone) => {
    if (!focusFromPointer()) setZone(next);
  }, []);
  const inHero = useCallback(() => enter('hero'), [enter]);
  const inSeasons = useCallback(() => enter('seasons'), [enter]);
  const inEpisodes = useCallback(() => enter('episodes'), [enter]);
  const inCast = useCallback(() => enter('cast'), [enter]);
  const inExtras = useCallback(() => enter('extras'), [enter]);
  const inBoxSet = useCallback(() => enter('boxSet'), [enter]);
  const inSimilar = useCallback(() => enter('similar'), [enter]);

  // A page opened from a "More Episodes" card puts the focus on its own card in that row, once.
  const showsSiblings = episode && episodes !== undefined && episodes.length > 1;
  const startedInRow = useRef(false);
  const startInRow = target.startInRow === true;
  useEffect(() => {
    if (!startInRow || !showsSiblings || startedInRow.current) return;
    startedInRow.current = true;
    moveFocusTo(cardFocusKey(EPISODE_ROW_ID, detail.content_id));
  }, [startInRow, showsSiblings, detail.content_id]);

  // --- The block under the hero: the seasons row, the episode grid, or "More Episodes" ----------
  // A series with several seasons shows them as a row of cards (a failed or pending read shows its
  // own stand-in there); a season, and a series with exactly one season, list the episodes.
  let seasonsBlock = null;
  if (series && seasonsQuery.isError && !seasonsQuery.data) {
    seasonsBlock = (
      <div className="detail-section-message" role="alert" data-testid="seasons-error">
        <p className="error">{t('detail.seasonsError')}</p>
        <Button
          focusKey="detail-seasons-retry"
          onFocused={inSeasons}
          onClick={() => void seasonsQuery.refetch()}
        >
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (series && seasonsQuery.isPending) {
    seasonsBlock = <SeasonRailSkeleton />;
  } else if (series && seasons.length > 1) {
    seasonsBlock = (
      <SeasonRail
        seasons={seasons}
        memory={memory.rows}
        onOpen={openSeason}
        onPlay={playSeason}
        onFocused={inSeasons}
      />
    );
  }

  let episodesBlock = null;
  if (season || singleSeason) {
    let grid;
    if (episodesQuery.isError && !episodes) {
      grid = (
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
    } else if (!episodes && episodesQuery.isLoading) {
      grid = <EpisodeGridSkeleton />;
    } else if (!episodes || episodes.length === 0) {
      grid = (
        <p className="note detail-section-message" data-testid="episodes-empty">
          {t('detail.episodesEmpty')}
        </p>
      );
    } else {
      grid = (
        <EpisodeGrid
          gridId={`episodes:${detail.content_id}`}
          episodes={episodes}
          memory={memory.rows}
          onOpen={openEpisode}
          onPlay={playEpisode}
          onFocused={inEpisodes}
        />
      );
    }
    episodesBlock = (
      <section
        className="detail-section detail-episodes"
        data-testid="detail-episodes"
        data-zone="episodes"
        data-faded={fade('episodes')}
      >
        <SectionHead title={t('detail.episodes')} count={episodes?.length} testId="episodes-head" />
        {grid}
      </section>
    );
  } else if (showsSiblings) {
    // The siblings of an episode: only a season with several episodes has such a row.
    episodesBlock = (
      <div
        className="detail-episode-row"
        data-testid="detail-more-episodes"
        data-zone="episodes"
        data-faded={fade('episodes')}
      >
        <EpisodeRow
          episodes={episodes}
          currentId={detail.content_id}
          memory={memory.rows}
          onOpen={openSibling}
          onPlay={playEpisode}
          onRowFocused={inEpisodes}
        />
      </div>
    );
  }

  // Which blocks exist below the hero: the observer is attached once per such set, and the tops
  // are measured when it changes (blocks appear as their data arrives).
  const blockSet = [
    seasonsBlock ? 'seasons' : '',
    episodesBlock ? 'episodes' : '',
    kind === 'item' && cast.length > 0 ? 'cast' : '',
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
            translation={translationLine}
            seasons={seasons}
            loadedEpisodes={episodes?.length}
            synopsis={synopsis}
            episodeSeason={
              episode
                ? seasons.find((one) => one.season_number === detail.season_number)
                : undefined
            }
            onMore={() => setSynopsisOpen(true)}
            actions={
              resolvingTarget ? null : (
                <ActionRow
                  detail={detail}
                  kind={kind}
                  playable={playable}
                  resumeSeconds={resumeSeconds}
                  totalSeconds={totalSeconds}
                  stateKnown={stateKnown}
                  onPlay={play}
                  onFocused={inHero}
                  onNotice={setNotice}
                  onTranslate={
                    translateShown
                      ? () => {
                          // The pill leaves with the run: hand the focus over before it does.
                          moveFocusTo(PLAY_KEY);
                          translation.start();
                        }
                      : undefined
                  }
                />
              )
            }
          />
          {seasonsBlock ? (
            <section
              className="detail-section detail-seasons-block"
              data-testid="detail-seasons"
              data-zone="seasons"
              data-faded={fade('seasons')}
            >
              {seasonsBlock}
            </section>
          ) : null}
          {episodesBlock}
          {kind === 'item' && cast.length > 0 ? (
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
        {synopsisOpen && synopsis.text ? (
          <SynopsisDialog
            title={season ? seasonLabel(detail, t) : detail.title}
            text={synopsis.text}
            onClose={() => setSynopsisOpen(false)}
          />
        ) : null}
      </main>
    </>
  );
}
