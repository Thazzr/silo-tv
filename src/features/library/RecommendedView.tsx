import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StartIntent } from '../../playback/resume';
import { Button } from '../../app/ui';
import { FocusGroup, focusFromPointer, stackArrows } from '../../app/nav';
import { useT } from '../../i18n';
import {
  CatalogRow,
  isLandscapeSection,
  keepAtOrigin,
  RowSkeleton,
  rowFocusKey,
  rowHeight,
  type CardShape,
  type CatalogItem,
} from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { ROW_ITEM_LIMIT } from '../home/queries';
import { useItemOpener } from '../home/useItemOpener';
import type { LibraryMemory } from './libraryMemory';
import { isMixed, useLibrarySections, type LibraryKind, type UserLibrary } from './queries';
import type { ExploreTarget } from './targets';

/** Rows mounted above and below the focused one; the others are an empty strip of the same height. */
const MOUNT_ROWS_BEFORE = 1;
const MOUNT_ROWS_AFTER = 2;

interface RowModel {
  id: string;
  title: string;
  shape: CardShape;
  items: CatalogItem[];
  hasMore: boolean;
}

/**
 * The rows of a library: its sections in server order, without the featured ones (those are the
 * hero of the server's own clients). A mixed library shows only the tab's kind in each row; an
 * empty row is not shown at all.
 */
export function libraryRows(
  sections: readonly {
    id: string;
    title: string;
    section_type: string;
    featured: boolean;
    has_more?: boolean;
    total_count: number;
    items: CatalogItem[];
  }[],
  library: UserLibrary,
  kind: LibraryKind,
): RowModel[] {
  const mixed = isMixed(library);
  return sections.flatMap((section) => {
    if (section.featured) return [];
    const kept = mixed
      ? section.items.filter((item) => item.type.trim().toLowerCase() === kind)
      : section.items;
    // The server cuts the rows already; the client holds the line when it did not.
    const items = kept.slice(0, ROW_ITEM_LIMIT);
    if (items.length === 0) return [];
    return [
      {
        id: `${library.id}/${section.id}`,
        title: section.title,
        shape: isLandscapeSection(section.section_type)
          ? ('landscape' as const)
          : ('poster' as const),
        items,
        hasMore:
          section.has_more === true ||
          section.total_count > items.length ||
          kept.length > items.length,
      },
    ];
  });
}

const lastRowKey = (library: UserLibrary, kind: LibraryKind) => `lastrow:${library.id}:${kind}`;

/**
 * A library's Recommended view: its sections as rows of cards, each ending in "Explore all". The
 * rows scroll with a transform so the focused row is at the top, and only the rows around it
 * have cards mounted. It never takes the focus by itself.
 */
export function RecommendedView({
  library,
  kind,
  memory,
  onPlay,
  onOpenDetail,
  onExploreSection,
}: {
  library: UserLibrary;
  kind: LibraryKind;
  memory: LibraryMemory;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onExploreSection: (section: ExploreTarget) => void;
}) {
  const t = useT();
  const query = useLibrarySections(library.id);
  const { open } = useItemOpener({ onPlay, onOpenDetail });
  const rows = useMemo(
    () => (query.data ? libraryRows(query.data, library, kind) : []),
    [query.data, library, kind],
  );
  const [focusedRow, setFocusedRow] = useState(
    () => memory.indices.get(lastRowKey(library, kind)) ?? 0,
  );
  const activeRow = Math.min(focusedRow, Math.max(0, rows.length - 1));
  const offset = rows.slice(0, activeRow).reduce((sum, row) => sum + rowHeight(row.shape), 0);

  // The rows are skipped while their props are the same, so what they get must not change when
  // the focus moves: these handlers are stable and read the latest props when called.
  const latest = useRef({ open, onExploreSection, library, kind });
  useEffect(() => {
    latest.current = { open, onExploreSection, library, kind };
  });
  const openCard = useCallback((item: CatalogItem) => latest.current.open(item), []);
  const exploreRow = useCallback((rowId: string, title: string) => {
    const now = latest.current;
    now.onExploreSection({
      id: rowId.slice(now.library.id.length + 1),
      title,
      library: { id: now.library.id, type: isMixed(now.library) ? now.kind : undefined },
    });
  }, []);
  const memoryIndices = memory.indices;
  const rowFocused = useCallback(
    (index: number) => {
      // The page scrolls to the focused row; a hovered card keeps the page where it is.
      if (!focusFromPointer()) setFocusedRow(index);
      memoryIndices.set(lastRowKey(latest.current.library, latest.current.kind), index);
    },
    [memoryIndices],
  );

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('library.loading')} data-testid="recommended-loading">
        <RowSkeleton shape="poster" />
        <RowSkeleton shape="poster" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="library-message" role="alert" data-testid="recommended-error">
        <p className="error">{t('library.error')}</p>
        <Button focusKey="library-retry" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="library-message" data-testid="recommended-empty">
        <p className="note">{t('library.recommended.empty')}</p>
      </div>
    );
  }

  return (
    <div
      className="library-rows"
      data-testid="recommended"
      data-transform-scrolled="page"
      onScroll={keepAtOrigin}
    >
      <FocusGroup
        focusKey="library-rows"
        enterable
        saveLastFocusedChild
        preferredChildFocusKey={rows[activeRow] ? rowFocusKey(rows[activeRow].id) : undefined}
        className="library-rows-inner"
        onArrow={stackArrows(rows.map((row) => rowFocusKey(row.id)))}
        style={{ transform: `translateY(${-offset}px)` }}
      >
        {rows.map((row, index) => (
          <CatalogRow
            key={row.id}
            rowId={row.id}
            title={row.title}
            shape={row.shape}
            items={row.items}
            hasMore={row.hasMore}
            memory={memory.indices}
            mounted={
              index >= activeRow - MOUNT_ROWS_BEFORE && index <= activeRow + MOUNT_ROWS_AFTER
            }
            prefetchRow={
              index === activeRow - MOUNT_ROWS_BEFORE - 1 ||
              index === activeRow + MOUNT_ROWS_AFTER + 1
            }
            rowIndex={index}
            onOpen={openCard}
            onExploreAll={exploreRow}
            onRowFocused={rowFocused}
          />
        ))}
      </FocusGroup>
    </div>
  );
}
