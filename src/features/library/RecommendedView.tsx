import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StartIntent } from '../../playback/resume';
import { Button } from '../../app/ui';
import { FocusGroup, focusFromPointer, stackArrows, useKeyFocusWithin } from '../../app/nav';
import { useT } from '../../i18n';
import { useSectionTitle, type SectionTitleSource } from '../../i18n/sectionTitle';
import {
  CatalogRow,
  keepAtOrigin,
  RowSkeleton,
  rowFocusKey,
  rowHeight,
  sectionCardShape,
  type CardShape,
  type CatalogItem,
} from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { HERO_KEY } from '../home/Carousel';
import { featuredSlides, firstFeatured } from '../home/featured';
import { Hero, type Featured } from '../home/Hero';
import { ROW_ITEM_LIMIT } from '../home/queries';
import { useItemOpener } from '../home/useItemOpener';
import type { LibraryMemory } from './libraryMemory';
import {
  isMixed,
  useLibraryFeaturedSection,
  useLibrarySections,
  type LibraryKind,
  type UserLibrary,
} from './queries';
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
 * The rows of a library: its sections in server order, without the one that is the hero's
 * carousel (`featuredId`). A mixed library shows only the tab's kind in each row; an empty row is
 * not shown at all.
 */
export function libraryRows(
  sections: readonly {
    id: string;
    title: string;
    title_key?: string;
    title_args?: Record<string, string>;
    section_type: string;
    featured: boolean;
    has_more?: boolean;
    total_count: number;
    items: CatalogItem[];
  }[],
  library: UserLibrary,
  kind: LibraryKind,
  titleOf: (section: SectionTitleSource) => string,
  featuredId?: string,
): RowModel[] {
  const mixed = isMixed(library);
  return sections.flatMap((section) => {
    if (section.id === featuredId) return [];
    const kept = mixed
      ? section.items.filter((item) => item.type.trim().toLowerCase() === kind)
      : section.items;
    // The server cuts the rows already; the client holds the line when it did not.
    const items = kept.slice(0, ROW_ITEM_LIMIT);
    if (items.length === 0) return [];
    return [
      {
        id: `${library.id}/${section.id}`,
        title: titleOf(section),
        shape: sectionCardShape(section.section_type),
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
 * A library's Recommended view: the hero carousel of its first featured section (bleeding under
 * the pills, and showing the focused card while the focus is in the rows) over its other sections
 * as rows of cards, each ending in "Explore all". The rows scroll with a transform so the
 * focused row is at the top, and only the rows around it have cards mounted. It never takes the
 * focus by itself.
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
  const titleOf = useSectionTitle();
  const query = useLibrarySections(library.id);
  const { open, openPage, playSlide } = useItemOpener({ onPlay, onOpenDetail });
  // The first featured section is the hero's carousel, read on its own; it is no row. A mixed
  // library's carousel shows only the tab's kind.
  const featuredId = query.data ? firstFeatured(query.data)?.id : undefined;
  const featuredQuery = useLibraryFeaturedSection(library.id, featuredId);
  const mixed = isMixed(library);
  const slides = useMemo(
    () => (featuredQuery.data ? featuredSlides(featuredQuery.data, mixed ? kind : undefined) : []),
    [featuredQuery.data, mixed, kind],
  );
  let featured: Featured | null = null;
  if (featuredId !== undefined) {
    if (featuredQuery.isPending) featured = { kind: 'loading' };
    else if (featuredQuery.isError) {
      featured = {
        kind: 'error',
        text: 'hero.failedLibrary',
        onRetry: () => void featuredQuery.refetch(),
      };
    } else if (slides.length > 0) {
      featured = { kind: 'slides', slides, onPlay: playSlide, onOpen: openPage };
    }
  }
  const rows = useMemo(
    () => (query.data ? libraryRows(query.data, library, kind, titleOf, featuredId) : []),
    [query.data, library, kind, titleOf, featuredId],
  );
  const [focusedRow, setFocusedRow] = useState(
    () => memory.indices.get(lastRowKey(library, kind)) ?? 0,
  );
  const [focusedCard, setFocusedCard] = useState<{ item: CatalogItem; shape: CardShape } | null>(
    null,
  );
  // Whether the focus is on something in the rows (not in the hero or above it).
  const [inRows, setInRows] = useState(false);
  const focusWithin = useKeyFocusWithin(setInRows);
  const activeRow = Math.min(focusedRow, Math.max(0, rows.length - 1));
  // The hero shows the focused card while the focus is in the rows, else its carousel.
  const carouselMode = featured !== null && !inRows;
  const heroCard = carouselMode ? null : focusedCard;
  const offset = carouselMode
    ? 0
    : rows.slice(0, activeRow).reduce((sum, row) => sum + rowHeight(row.shape), 0);

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
  const cardFocused = useCallback(
    (item: CatalogItem, shape: CardShape) => setFocusedCard({ item, shape }),
    [],
  );
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
  if (rows.length === 0 && featured === null) {
    return (
      <div className="library-message" data-testid="recommended-empty">
        <p className="note">{t('library.recommended.empty')}</p>
      </div>
    );
  }

  return (
    <FocusGroup
      focusKey="library-stack"
      enterable
      saveLastFocusedChild
      className="library-stage"
      data-rows={inRows}
      data-featured={featured !== null}
      // Up and Down go from the hero to the rows and from row to row by index.
      onArrow={stackArrows([
        ...(featured?.kind === 'slides' || featured?.kind === 'error' ? [HERO_KEY] : []),
        ...rows.map((row) => rowFocusKey(row.id)),
      ])}
    >
      {featured ? (
        <Hero
          item={heroCard?.item ?? null}
          wide={heroCard?.shape === 'landscape'}
          featured={featured}
        />
      ) : null}
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
          onFocusWithin={focusWithin}
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
                (index >= activeRow - MOUNT_ROWS_BEFORE && index <= activeRow + MOUNT_ROWS_AFTER) ||
                (featured !== null && index <= MOUNT_ROWS_AFTER)
              }
              prefetchRow={
                index === activeRow - MOUNT_ROWS_BEFORE - 1 ||
                index === activeRow + MOUNT_ROWS_AFTER + 1
              }
              rowIndex={index}
              onOpen={openCard}
              onExploreAll={exploreRow}
              onRowFocused={rowFocused}
              onCardFocused={cardFocused}
            />
          ))}
        </FocusGroup>
      </div>
    </FocusGroup>
  );
}
