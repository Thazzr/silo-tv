import { useEffect, useMemo, useRef, useState } from 'react';
import type { StartIntent } from '../../playback/resume';
import { Button } from '../../app/ui';
import { FocusGroup, Focusable, setFocus } from '../../app/nav';
import { useT } from '../../i18n';
import { Grid, GridSkeleton, gridCardKey, PosterCard, type CatalogItem } from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
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
import type { LibraryMemory } from './libraryMemory';
import {
  useBrowsePages,
  useCatalogFilters,
  useExtendedRules,
  useLetters,
  type LibraryKind,
  type UserLibrary,
} from './queries';
import { SortList } from './SortList';

export type BrowseOverlay = 'sort' | 'filter' | null;

export const SORT_PILL_KEY = 'browse-sort';
export const FILTER_PILL_KEY = 'browse-filter';

/**
 * A library's Browse view: a toolbar with the Sort and Filter pills, the poster grid of the
 * library's titles (paged, 40 at a time) and the alphabet rail at the right edge. Sort, filters
 * and letter are kept in the session's memory per library. It never takes the focus by itself,
 * except that OK on a letter moves it into the grid on the first title shown.
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
  const gridId = `browse:${library.id}:${kind}`;
  const [selection, setSelection] = useState<BrowseSelection>(() =>
    memory.browseOf(kind, library.id),
  );
  const pages = useBrowsePages(library.id, kind, selection);
  const letters = useLetters(library.id, kind, selection);
  const filterFacets = useCatalogFilters(library.id, kind);
  const extended = useExtendedRules();
  const items = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  const firstKey = items[0] ? gridCardKey(gridId, items[0].content_id) : undefined;

  // OK on a letter moves the focus into the grid once the titles under it are there.
  const wantGrid = useRef(false);
  useEffect(() => {
    if (!wantGrid.current) return;
    if (firstKey) {
      wantGrid.current = false;
      void setFocus(firstKey);
    } else if (!pages.isPending) {
      wantGrid.current = false;
    }
  }, [firstKey, pages.isPending]);

  /** A new selection starts its grid at the first title; the focus index of the old one is dropped. */
  const choose = (patch: Partial<BrowseSelection>) => {
    const next = { ...selection, ...patch };
    memory.setBrowse(kind, library.id, next);
    memory.indices.set(gridId, 0);
    wantGrid.current = false;
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
  const pickLetter = (letter: string) => {
    choose({ letter: letter === selection.letter ? null : letter });
    wantGrid.current = true;
  };

  const active = filterCount(selection.filters);
  const filtered = active > 0 || selection.letter !== null;

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
        hasMore={pages.hasNextPage}
        loadingMore={pages.isFetchingNextPage}
        onLoadMore={() => void pages.fetchNextPage()}
        memory={memory.indices}
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
        <AlphabetRail
          available={letters.data}
          selected={selection.letter}
          numbersEnabled={extended}
          onPick={pickLetter}
        />
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
          onApply={applyFilters}
        />
      ) : null}
    </div>
  );
}
