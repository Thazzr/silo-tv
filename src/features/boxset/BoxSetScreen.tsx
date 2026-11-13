import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { focusFromPointer, useBackHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import {
  Grid,
  GridSkeleton,
  keepAtOrigin,
  PosterCard,
  useArtUrl,
  useMediaUrl,
  type CatalogItem,
  type GridCardContext,
} from '../../ui/media';
import { BackdropLayer, Synopsis } from '../detail/DetailHero';
import type { DetailTarget } from '../detail/detailMemory';
import { SynopsisDialog } from '../detail/SynopsisDialog';
import { useItemOpener } from '../home/useItemOpener';
import type { StartIntent } from '../../playback/resume';
import { chipLine, playLabel, playTarget, type BoxSetDetail } from './info';
import { BOXSET_HERO_HEIGHT, boxSetScrollOffset, type BoxSetZone } from './layout';
import type { BoxSetEntryMemory, BoxSetTarget } from './boxSetMemory';
import { useBoxSet } from './queries';

export interface BoxSetScreenProps {
  target: BoxSetTarget;
  /** What this visit remembers while a film's page covers it. */
  memory: BoxSetEntryMemory;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onBack: () => void;
}

export const BOXSET_PLAY_KEY = 'boxset-play';

/**
 * The page of a box set: the hero like a detail page's (no logo) with one Play pill, then the
 * films as a poster grid in collection order. The title and backdrop of the route paint at once
 * and the box set is read behind a skeleton shaped like the page; it is read again whenever the
 * page shows again, because playing a film changes the counts. A box set that is not available
 * says so with Back, any other failure offers Try again.
 */
export function BoxSetScreen(props: BoxSetScreenProps) {
  const t = useT();
  const { target } = props;
  const box = useBoxSet(target.boxSetId, target.libraryId);

  if (box.data) return <BoxSetBody box={box.data} {...props} />;

  if (box.isPending) return <BoxSetSkeleton target={target} />;

  const gone = box.error instanceof SiloApiError && box.error.status === 404;
  return (
    <main className="detail" data-testid="boxset">
      <div
        className="detail-message"
        role="alert"
        data-testid={gone ? 'boxset-gone' : 'boxset-error'}
      >
        {gone ? (
          <>
            <h1 className="error boxset-gone-title">{t('boxset.gone')}</h1>
            <p className="note">{t('boxset.goneHint')}</p>
          </>
        ) : (
          <p className="error">{t('boxset.error')}</p>
        )}
        <Button
          focusKey="boxset-retry"
          autoFocus
          onClick={gone ? props.onBack : () => void box.refetch()}
        >
          {t(gone ? 'boxset.goneBack' : 'common.retry')}
        </Button>
      </div>
    </main>
  );
}

/** The loading stand-in: the route's title and backdrop, bars for the rest, a skeleton grid. */
function BoxSetSkeleton({ target }: { target: BoxSetTarget }) {
  const t = useT();
  const url = useMediaUrl();
  return (
    <main
      className="detail boxset"
      data-testid="boxset"
      role="status"
      aria-label={t('boxset.loading')}
    >
      <BackdropLayer backdrop={url(target.backdropUrl)} scrolled={false} />
      <div className="detail-page">
        <div className="detail-hero" style={{ minHeight: BOXSET_HERO_HEIGHT }}>
          <div className="detail-text">
            {target.boxSetTitle ? (
              <h1 className="detail-title" data-testid="boxset-title">
                {target.boxSetTitle}
              </h1>
            ) : (
              <div className="skeleton-bar detail-skeleton-title" />
            )}
            <div className="skeleton-bar detail-skeleton-meta" />
            <div className="skeleton-bar detail-skeleton-synopsis" />
            <div className="skeleton-bar detail-skeleton-play" />
          </div>
        </div>
        <section className="boxset-films">
          <h2 className="boxset-films-title">{t('boxset.movies')}</h2>
          <GridSkeleton />
        </section>
      </div>
    </main>
  );
}

function BoxSetBody({
  box,
  memory,
  onPlay,
  onOpenDetail,
}: BoxSetScreenProps & { box: BoxSetDetail }) {
  const t = useT();
  const url = useMediaUrl();

  // --- The overview in full ----------------------------------------------------------------------
  const [overviewOpen, setOverviewOpen] = useState(false);
  // Back closes the overview first; without a handler it leaves the page.
  useBackHandler(overviewOpen ? () => setOverviewOpen(false) : undefined);

  // --- Play ---------------------------------------------------------------------------------------
  const play = playTarget(box);

  // --- The films: OK opens a film's page, the Play key plays it -----------------------------------
  const { open, play: playFilm } = useItemOpener({ onPlay, onOpenDetail });
  const artUrl = useArtUrl('poster');

  // --- Vertical scroll: the page moves once, from the hero to the films --------------------------
  const [zone, setZone] = useState<BoxSetZone>('top');
  // A hovered element keeps the page where it is (nav/origin.ts): only keys change the zone.
  const inTop = useCallback(() => {
    if (!focusFromPointer()) setZone('top');
  }, []);
  const inFilms = useCallback(() => {
    if (!focusFromPointer()) setZone('films');
  }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  // The films block's top is measured, not assumed: the hero grows with a long title or overview.
  const [filmsTop, setFilmsTop] = useState<number | undefined>(undefined);
  const measure = useCallback(() => {
    const el = pageRef.current?.querySelector<HTMLElement>('[data-boxset-films]');
    const next = el ? el.offsetTop : undefined;
    setFilmsTop((old) => (old === next ? old : next));
  }, []);
  useLayoutEffect(() => {
    measure();
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === 'undefined') return;
    // Whenever a box changes size (fonts, a longer overview): measure again.
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    page
      .querySelectorAll('.detail-hero, [data-boxset-films]')
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [measure]);
  // Stable, so a re-render of the page (a zone change) does not redraw every card of the grid.
  const renderCard = useCallback(
    (item: CatalogItem, ctx: GridCardContext) => (
      <PosterCard
        grid
        item={item}
        focusKey={ctx.focusKey}
        onFocused={() => {
          ctx.onFocused();
          inFilms();
        }}
        onOpen={open}
        onPlay={playFilm}
      />
    ),
    [inFilms, open, playFilm],
  );
  const offset = boxSetScrollOffset(zone, filmsTop);
  const gridId = `boxset:${box.id}`;

  return (
    <main
      className="detail boxset"
      data-testid="boxset"
      data-transform-scrolled="page"
      onScroll={keepAtOrigin}
    >
      <BackdropLayer backdrop={url(box.backdrop_url)} scrolled={zone !== 'top'} />
      <div ref={pageRef} className="detail-page" style={{ transform: `translateY(${-offset}px)` }}>
        <div
          className="detail-hero"
          data-testid="boxset-hero"
          style={{ minHeight: BOXSET_HERO_HEIGHT }}
        >
          <div className="detail-text" data-faded={zone === 'films'}>
            <h1 className="detail-title" data-testid="boxset-title">
              {box.title}
            </h1>
            <p className="detail-meta" data-testid="boxset-meta">
              {chipLine(box, t)}
            </p>
            {box.overview ? (
              <Synopsis text={box.overview} onMore={() => setOverviewOpen(true)} />
            ) : null}
            {play ? (
              <div className="detail-row detail-actions" role="group">
                <Button
                  focusKey={BOXSET_PLAY_KEY}
                  className="detail-pill detail-play"
                  autoFocus
                  onFocused={inTop}
                  onClick={() => onPlay(play.item, { kind: 'resume' })}
                >
                  {playLabel(play, t)}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <section className="boxset-films" data-boxset-films data-testid="boxset-films">
          <h2 className="boxset-films-title">{t('boxset.movies')}</h2>
          {box.items.length > 0 ? (
            <Grid
              gridId={gridId}
              items={box.items}
              getKey={(item) => item.content_id}
              hasMore={false}
              loadingMore={false}
              onLoadMore={noop}
              memory={memory.grid}
              artUrl={artUrl}
              renderCard={renderCard}
            />
          ) : null}
        </section>
      </div>
      {overviewOpen && box.overview ? (
        <SynopsisDialog
          title={box.title}
          text={box.overview}
          onClose={() => setOverviewOpen(false)}
        />
      ) : null}
    </main>
  );
}

const noop = () => undefined;
