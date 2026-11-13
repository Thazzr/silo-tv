import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SiloApiError } from '../../api/problem';
import { focusFromPointer, useBackHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import {
  Grid,
  GridSkeleton,
  type GridCardContext,
  keepAtOrigin,
  PosterCard,
  useArtUrl,
  type CatalogItem,
} from '../../ui/media';
import type { StartIntent } from '../../playback/resume';
import { useItemOpener } from '../home/useItemOpener';
import { SynopsisDialog } from '../detail/SynopsisDialog';
import type { DetailTarget } from '../detail/detailMemory';
import { PillRow, type PillItem } from '../library/PillRow';
import { countLabel, type PersonFilter } from './info';
import { PILLS_GAP, PILLS_HEIGHT, personScrollOffset, type PersonZone } from './layout';
import { PersonHeader, PersonHeaderSkeleton } from './PersonHeader';
import type { PersonEntryMemory, PersonTarget } from './personMemory';
import { usePerson, usePersonHas, usePersonTitles } from './queries';

export interface PersonScreenProps {
  target: PersonTarget;
  /** What this visit remembers while a title's page covers it. */
  memory: PersonEntryMemory;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onBack: () => void;
}

const PILL_KEY_PREFIX = 'person-pill:';

/** A one-card read that has settled without a title of that kind (or failed): its pill goes. */
const absent = (probe: { isError: boolean; data: boolean | undefined }) =>
  probe.isError || probe.data === false;

/**
 * The page of a person: portrait, name, facts and biography, then the filmography as a poster
 * grid, newest first, that can be narrowed to movies or series. The header paints from the route's
 * name at once; the person is read behind a skeleton shaped like the page. A person that is gone
 * says so with Back, any other failure offers Try again. The page scrolls once, so the filter
 * pills sit on the top safe line while the focus is in the grid.
 */
export function PersonScreen({ target, memory, onPlay, onOpenDetail, onBack }: PersonScreenProps) {
  const t = useT();
  const personId = target.personId;
  const person = usePerson(personId);

  // --- Filmography filter: a pill is shown only when it has titles, and it takes effect on OK ----
  const hasMovie = usePersonHas(personId, 'movie');
  const hasSeries = usePersonHas(personId, 'series');
  const [picked, setPicked] = useState<PersonFilter>(memory.filter);
  // A chosen filter whose pill dropped out falls back to "All", which is then read.
  const filter: PersonFilter =
    (picked === 'movie' && absent(hasMovie)) || (picked === 'series' && absent(hasSeries))
      ? 'all'
      : picked;
  const pills = useMemo<PillItem[]>(
    () => [
      { id: 'all', label: t('person.filter.all') },
      ...(hasMovie.data === true ? [{ id: 'movie', label: t('person.filter.movies') }] : []),
      ...(hasSeries.data === true ? [{ id: 'series', label: t('person.filter.series') }] : []),
    ],
    [t, hasMovie.data, hasSeries.data],
  );
  const gridId = `person:${personId}:${filter}`;
  const pickFilter = useCallback(
    (id: string) => {
      const next = id as PersonFilter;
      memory.pickFilter(next);
      // A new list starts at its first title.
      memory.grid.set(`person:${personId}:${next}`, 0);
      setPicked(next);
    },
    [memory, personId],
  );

  const titles = usePersonTitles(personId, filter);
  const items = useMemo(
    () => titles.data?.pages.flatMap((page) => page.items) ?? [],
    [titles.data],
  );
  const exact = titles.data?.pages[0]?.total_exact ?? true;
  const total = titles.data?.pages[0]?.total ?? 0;

  const { open, play } = useItemOpener({ onPlay, onOpenDetail });
  const artUrl = useArtUrl('poster');

  // --- The biography in full ---------------------------------------------------------------------
  const [bioOpen, setBioOpen] = useState(false);
  // Back closes the biography first; without a handler it leaves the page.
  useBackHandler(bioOpen ? () => setBioOpen(false) : undefined);

  // --- Vertical scroll: the page moves once, from the header to the filmography ------------------
  const [zone, setZone] = useState<PersonZone>('top');
  // A hovered element keeps the page where it is (nav/origin.ts): only keys change the zone.
  const inTop = useCallback(() => {
    if (!focusFromPointer()) setZone('top');
  }, []);
  const inGrid = useCallback(() => {
    if (!focusFromPointer()) setZone('grid');
  }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  // The pills' top is measured, not assumed: the header grows with the biography.
  const [pillsTop, setPillsTop] = useState<number | undefined>(undefined);
  const measure = useCallback(() => {
    const el = pageRef.current?.querySelector<HTMLElement>('[data-person-pills]');
    const next = el ? el.offsetTop : undefined;
    setPillsTop((old) => (old === next ? old : next));
  }, []);
  const loaded = person.data !== undefined;
  const pillsShown = !(filter === 'all' && titles.isSuccess && items.length === 0);
  useLayoutEffect(() => {
    measure();
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === 'undefined') return;
    // Whenever a box changes size (fonts, a longer biography): measure again.
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    page
      .querySelectorAll('.person-header, [data-person-pills]')
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [measure, loaded, pillsShown]);
  // Stable, so a re-render of the page (a zone change) does not redraw every card of the grid.
  const renderCard = useCallback(
    (item: CatalogItem, ctx: GridCardContext) => (
      <PosterCard
        grid
        item={item}
        focusKey={ctx.focusKey}
        onFocused={() => {
          ctx.onFocused();
          inGrid();
        }}
        onOpen={open}
        onPlay={play}
      />
    ),
    [inGrid, open, play],
  );
  const offset = personScrollOffset(zone, pillsTop);
  const faded = zone === 'grid';

  // --- The person itself: gone or failed ------------------------------------------------------------
  if (!person.data && !person.isPending) {
    const gone = person.error instanceof SiloApiError && person.error.status === 404;
    return (
      <main className="person" data-testid="person">
        <div
          className="person-message"
          role="alert"
          data-testid={gone ? 'person-gone' : 'person-error'}
        >
          <p className="error">{t(gone ? 'person.gone' : 'person.error')}</p>
          <Button
            focusKey="person-retry"
            autoFocus
            onClick={gone ? onBack : () => void person.refetch()}
          >
            {t(gone ? 'person.goneBack' : 'common.retry')}
          </Button>
        </div>
      </main>
    );
  }

  // --- The filmography block ---------------------------------------------------------------------
  let body;
  if (titles.isPending) {
    body = <GridSkeleton />;
  } else if (titles.isError && items.length === 0) {
    body = (
      <div className="person-message" role="alert" data-testid="person-titles-error">
        <p className="error">{t('person.titles.error')}</p>
        <Button
          focusKey="person-titles-retry"
          onFocused={inGrid}
          onClick={() => void titles.refetch()}
        >
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="person-message" data-testid="person-titles-empty">
        <h2 className="person-empty-title">{t('person.titles.emptyTitle')}</h2>
        <p className="note">{t('person.titles.empty')}</p>
      </div>
    );
  } else {
    body = (
      <Grid
        key={gridId}
        gridId={gridId}
        items={items}
        getKey={(item) => item.content_id}
        hasMore={titles.hasNextPage}
        loadingMore={titles.isFetchingNextPage}
        onLoadMore={() => void titles.fetchNextPage()}
        memory={memory.grid}
        artUrl={artUrl}
        renderCard={renderCard}
      />
    );
  }

  return (
    <main
      className="person"
      data-testid="person"
      data-transform-scrolled="page"
      onScroll={keepAtOrigin}
    >
      <div ref={pageRef} className="person-page" style={{ transform: `translateY(${-offset}px)` }}>
        {person.data ? (
          <PersonHeader person={person.data} faded={faded} onMore={() => setBioOpen(true)} />
        ) : (
          <PersonHeaderSkeleton name={target.personName} />
        )}
        <section className="person-films" data-testid="person-films">
          <div className="person-films-head" data-faded={faded}>
            <h2 className="person-films-title">{t('person.filmography')}</h2>
            {person.data && titles.isSuccess && items.length > 0 ? (
              <span className="person-films-count" data-testid="person-count">
                {countLabel(exact ? total : items.length, exact, t)}
              </span>
            ) : null}
          </div>
          <div
            className="person-pills-box"
            data-person-pills
            style={{ height: PILLS_HEIGHT + PILLS_GAP }}
          >
            {person.data && pillsShown ? (
              <PillRow
                focusKey="person-pills"
                keyPrefix={PILL_KEY_PREFIX}
                label={t('person.filter.label')}
                items={pills}
                selected={filter}
                onPick={pickFilter}
                onFocused={inTop}
                autoFocus
                testId="person-pills"
              />
            ) : null}
          </div>
          {person.data ? body : <GridSkeleton />}
        </section>
      </div>
      {bioOpen && person.data?.bio ? (
        <SynopsisDialog
          title={person.data.name}
          text={person.data.bio}
          onClose={() => setBioOpen(false)}
        />
      ) : null}
    </main>
  );
}
