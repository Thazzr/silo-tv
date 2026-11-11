import { useMemo, useState } from 'react';
import type { StartIntent } from '../../playback/resume';
import { Button } from '../../app/ui';
import { FocusGroup, Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import {
  DEFAULT_GRID,
  Grid,
  GridSkeleton,
  gridCardKey,
  gridWindow,
  PosterCard,
  useArtUrl,
  type CatalogItem,
  type GridWindow,
} from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { GRID_PAGE_SIZE } from '../home/queries';
import { useItemOpener } from '../home/useItemOpener';
import { AlphabetRail } from './AlphabetRail';
import {
  browseSignature,
  defaultDescending,
  filterCount,
  SORT_LABELS,
  type BrowseSelection,
  type FilterSelection,
  type SortKey,
} from './browse';
import { FilterPanel } from './FilterPanel';
import { jumpPosition, letterAtIndex } from './letterIndex';
import type { LibraryMemory } from './libraryMemory';
import {
  useBrowsePages,
  useBrowseWindow,
  useCatalogFilters,
  useExtendedRules,
  useLetters,
  useWatchRules,
  type LibraryKind,
  type UserLibrary,
} from './queries';
import { SortList } from './SortList';

const rowsOf = (total: number) => Math.ceil(total / DEFAULT_GRID.columns);

/** The last page index of a list of `total` titles. */
const lastPage = (total: number) => Math.max(0, Math.ceil(total / GRID_PAGE_SIZE) - 1);

export type BrowseOverlay = 'sort' | 'filter' | null;

export const SORT_PILL_KEY = 'browse-sort';
export const FILTER_PILL_KEY = 'browse-filter';

/**
 * A library's Browse view: a toolbar with the Sort and Filter pills, the poster grid of the
 * library's titles (paged, 40 at a time) and, in title order, the alphabet rail at the right
 * edge. Sort and filters are kept in the session's memory per library. The rail only jumps: the
 * list stays complete, and the grid scrolls to the first title of the letter. A jump far down
 * loads the titles around its target by position (`seek`) and not every page before it. The view
 * never takes the focus by itself.
 */
export function BrowseView({
  library,
  kind,
  memory,
  overlay,
  onOverlay,
  onPlay,
  onOpenDetail,
}: {
  library: UserLibrary;
  kind: LibraryKind;
  memory: LibraryMemory;
  overlay: BrowseOverlay;
  onOverlay: (overlay: BrowseOverlay) => void;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const t = useT();
  const { open } = useItemOpener({ onPlay, onOpenDetail });
  const artUrl = useArtUrl('poster');
  const gridId = `browse:${library.id}:${kind}`;
  const [selection, setSelection] = useState<BrowseSelection>(() =>
    memory.browseOf(kind, library.id),
  );
  const pages = useBrowsePages(library.id, kind, selection);
  const letters = useLetters(library.id, kind, selection);
  const filterFacets = useCatalogFilters(library.id, kind);
  const extended = useExtendedRules();
  const watchRules = useWatchRules(library.id, kind);
  // The rail needs the title order and the server's letter index.
  const letterIndex = selection.sort === 'title' ? letters.data : undefined;
  const base = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);

  // After a jump the grid is addressed by list position: the first page and the pages around the
  // rows in view are read, and the rest of the list is skeleton cards.
  const [jumped, setJumped] = useState(() => memory.isJumped(gridId));
  const [jump, setJump] = useState<{ index: number } | null>(null);
  const [view, setView] = useState<GridWindow>({ top: 0, first: 0, end: 0 });
  const byPosition = jumped && letterIndex !== undefined;
  const total = Math.max(letterIndex?.total ?? 0, base.length);
  const wanted = useMemo(() => {
    if (!byPosition) return [];
    const last = Math.min(
      Math.floor(Math.max(view.end - 1, 0) / GRID_PAGE_SIZE) + 1,
      lastPage(total),
    );
    const wantedPages: number[] = [];
    for (let page = Math.floor(view.first / GRID_PAGE_SIZE); page <= last; page += 1) {
      if (Math.min((page + 1) * GRID_PAGE_SIZE, total) > base.length) wantedPages.push(page);
    }
    return wantedPages;
  }, [byPosition, view.first, view.end, total, base.length]);
  const seeked = useBrowseWindow(
    library.id,
    kind,
    selection,
    wanted,
    pages.data?.pages[0]?.window_cursor,
  );
  const items = useMemo(() => {
    if (!byPosition) return base;
    const list = Array.from<CatalogItem | undefined>({ length: total });
    base.forEach((item, i) => {
      list[i] = item;
    });
    for (const [page, titles] of seeked.pages) {
      titles.forEach((item, i) => {
        const position = page * GRID_PAGE_SIZE + i;
        if (position >= base.length && position < total) list[position] = item;
      });
    }
    return list;
    // `seeked.version` stands for the pages: the map is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPosition, base, total, seeked.version]);
  // The last title of the top row: a jump puts the letter's first title in that row, often after
  // the titles of the letter before it.
  const topRowEnd = Math.min(view.top + DEFAULT_GRID.columns - 1, total - 1);
  const activeLetter = letterIndex ? letterAtIndex(letterIndex.runs, topRowEnd) : undefined;

  /** A new selection starts its grid at the first title; the focus index of the old one is dropped. */
  const choose = (patch: Partial<BrowseSelection>) => {
    const next = { ...selection, ...patch };
    memory.setBrowse(kind, library.id, next);
    memory.indices.set(gridId, 0);
    memory.setJumped(gridId, false);
    setJumped(false);
    setJump(null);
    setSelection(next);
  };
  const chooseSort = (sort: SortKey) => {
    onOverlay(null);
    choose(
      sort === selection.sort
        ? { descending: !selection.descending }
        : { sort, descending: defaultDescending(sort) },
    );
  };
  const applyFilters = (filters: FilterSelection) => {
    onOverlay(null);
    if (JSON.stringify(filters) !== JSON.stringify(selection.filters)) choose({ filters });
  };
  /** The rail's OK: the grid scrolls to the letter's first title, and the focus stays on the rail. */
  const jumpToLetter = (letter: string) => {
    const position = letterIndex ? jumpPosition(letterIndex.runs, letter) : undefined;
    if (position === undefined) return;
    memory.setJumped(gridId, true);
    setJumped(true);
    setJump({ index: position });
    // The grid reports the same window once it has scrolled; until then the pages of the old one
    // must not be read for the new place.
    setView(
      gridWindow(Math.floor(position / DEFAULT_GRID.columns), rowsOf(total), DEFAULT_GRID.columns),
    );
  };
  /** Left from the rail enters the grid on the card it last had the focus or the jump on. */
  const gridEntry = () => {
    const at = memory.indices.get(gridId);
    const item = at === undefined ? undefined : items[at];
    return item ? gridCardKey(gridId, item.content_id) : undefined;
  };

  const active = filterCount(selection.filters);
  const filtered = active > 0;

  let body;
  if (pages.isPending) {
    body = <GridSkeleton />;
  } else if (pages.isError && items.length === 0) {
    body = (
      <div className="library-message" role="alert" data-testid="browse-error">
        <p className="error">{t('library.error')}</p>
        <Button focusKey="browse-retry" onClick={() => void pages.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="library-message" data-testid="browse-empty">
        <p className="note">{t(filtered ? 'library.browse.noMatch' : 'library.browse.empty')}</p>
      </div>
    );
  } else {
    body = (
      <Grid
        key={browseSignature(selection)}
        gridId={gridId}
        items={items}
        getKey={(item) => item.content_id}
        hasMore={!byPosition && pages.hasNextPage}
        loadingMore={!byPosition && pages.isFetchingNextPage}
        onLoadMore={() => void pages.fetchNextPage()}
        memory={memory.indices}
        onWindow={setView}
        jumpTo={jump}
        artUrl={artUrl}
        renderCard={(item, ctx) => (
          <PosterCard
            grid
            item={item}
            focusKey={ctx.focusKey}
            onFocused={ctx.onFocused}
            onOpen={open}
          />
        )}
      />
    );
  }

  return (
    <div className="browse" data-testid="browse">
      <FocusGroup
        focusKey="browse-toolbar"
        enterable
        saveLastFocusedChild
        className="browse-toolbar"
      >
        <Focusable
          focusKey={SORT_PILL_KEY}
          className="btn lib-tool lib-tool-sort"
          aria-haspopup="menu"
          onClick={() => onOverlay('sort')}
        >
          {t('library.sort.pill', { name: t(SORT_LABELS[selection.sort]) })}
        </Focusable>
        <Focusable
          focusKey={FILTER_PILL_KEY}
          className={`btn lib-tool${active > 0 ? ' active' : ''}`}
          aria-haspopup="dialog"
          onClick={() => onOverlay('filter')}
        >
          {t('library.filter.pill')}
          {active > 0 ? (
            <span
              className="lib-count"
              data-testid="filter-count"
              aria-label={t('library.filter.active', { count: active })}
            >
              {active}
            </span>
          ) : null}
        </Focusable>
      </FocusGroup>
      <div className="browse-main">
        <div className="browse-grid">{body}</div>
        {letterIndex ? (
          <AlphabetRail
            lit={letterIndex.lit}
            active={activeLetter}
            gridEntry={gridEntry}
            onJump={jumpToLetter}
          />
        ) : null}
      </div>
      {overlay === 'sort' ? (
        <SortList sort={selection.sort} descending={selection.descending} onChoose={chooseSort} />
      ) : null}
      {overlay === 'filter' ? (
        <FilterPanel
          filters={selection.filters}
          facets={filterFacets.data}
          loading={filterFacets.isPending}
          extended={extended}
          watchRules={watchRules}
          onApply={applyFilters}
        />
      ) : null}
    </div>
  );
}
