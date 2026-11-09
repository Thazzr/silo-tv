import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContentBack } from '../../app/shell/ShellBack';
import { Button } from '../../app/ui';
import { FocusGroup, getCurrentFocusKey } from '../../app/nav';
import { useT } from '../../i18n';
import { getPlatform } from '../../platform';
import {
  cardFocusKey,
  cardTitle,
  isLandscapeSection,
  keepAtOrigin,
  LandscapeCard,
  PosterCard,
  Row,
  RowSkeleton,
  ROW_ERROR_HEIGHT,
  rowFocusKey,
  rowHeight,
  type CardShape,
  type CatalogItem,
  type FocusIndexMemory,
} from '../../ui/media';
import { Hero, HeroSkeleton } from './Hero';
import {
  ROW_ITEM_LIMIT,
  useDismissItem,
  useHomeSections,
  useSectionReader,
  type DismissSurface,
  type HomeSection,
} from './queries';
import { RemoveDialog } from './RemoveDialog';
import { useItemOpener } from './useItemOpener';

/** How long OK must be held on a Continue Watching card to ask about removing it. */
export const LONG_PRESS_MS = 600;
/** Rows mounted above and below the focused one; the others are an empty strip of the same height. */
const MOUNT_ROWS_BEFORE = 1;
const MOUNT_ROWS_AFTER = 2;
const LAST_ROW_KEY = 'home:last-row';

interface RowModel {
  id: string;
  title: string;
  shape: CardShape;
  items: CatalogItem[];
  hasMore: boolean;
  /** Where a card of the row can be removed from; null for rows that have no such thing. */
  surface: DismissSurface | null;
  failed: boolean;
}

/** A section read again on its own replaces the list's version until the list is read anew. */
type Override = { kind: 'section'; section: HomeSection } | { kind: 'failed' };

const NO_OVERRIDES: Record<string, Override> = {};

function surfaceOf(sectionType: string): DismissSurface | null {
  if (sectionType === 'continue_watching') return 'continue_watching';
  if (sectionType === 'next_up') return 'next_up';
  return null;
}

function rowFrom(section: HomeSection, override: Override | undefined): RowModel | null {
  const base = {
    id: section.id,
    title: section.title,
    shape: isLandscapeSection(section.section_type) ? ('landscape' as const) : ('poster' as const),
    surface: surfaceOf(section.section_type),
  };
  if (override?.kind === 'failed') return { ...base, items: [], hasMore: false, failed: true };
  const source = override?.section ?? section;
  // The server cuts the rows already; the client holds the line when it did not.
  const items = source.items.slice(0, ROW_ITEM_LIMIT);
  // An empty section is not shown at all.
  if (items.length === 0) return null;
  const hasMore = source.has_more === true || source.total_count > items.length;
  return { ...base, items, hasMore, failed: false };
}

const heightOf = (row: RowModel) => (row.failed ? ROW_ERROR_HEIGHT : rowHeight(row.shape));

interface PendingRemoval {
  row: RowModel;
  item: CatalogItem;
}

export interface HomeScreenProps {
  /** Where each row's focus was when Home was last shown; it outlives this screen. */
  rowMemory: FocusIndexMemory;
  onPlay: (item: CatalogItem) => void;
  /** "Explore all" of a row: opens its full list. */
  onExploreSection: (section: { id: string; title: string }) => void;
}

/**
 * The Home tab: the server's sections as rows of cards under a hero that shows the focused card.
 * Rows come in server order; an empty section is hidden and a row that cannot be read shows a
 * small error with "Try again" instead. The rows scroll with a transform so the focused row sits
 * just below the hero, and only the rows around it have cards mounted.
 */
export function HomeScreen({ rowMemory, onPlay, onExploreSection }: HomeScreenProps) {
  const t = useT();
  const { query, rowLimit } = useHomeSections();
  const readSection = useSectionReader(rowLimit);
  const dismiss = useDismissItem();
  const { open, note } = useItemOpener(onPlay);

  const [overrides, setOverrides] = useState<{ stamp: number; map: Record<string, Override> }>({
    stamp: 0,
    map: {},
  });
  const activeOverrides = useMemo(
    () => (overrides.stamp === query.dataUpdatedAt ? overrides.map : NO_OVERRIDES),
    [overrides, query.dataUpdatedAt],
  );
  const setOverride = useCallback(
    (id: string, override: Override) =>
      setOverrides((current) => ({
        stamp: query.dataUpdatedAt,
        map: { ...(current.stamp === query.dataUpdatedAt ? current.map : {}), [id]: override },
      })),
    [query.dataUpdatedAt],
  );

  const rows = useMemo(
    () =>
      (query.data ?? []).flatMap((section) => {
        const row = rowFrom(section, activeOverrides[section.id]);
        return row ? [row] : [];
      }),
    [query.data, activeOverrides],
  );

  const [focusedRow, setFocusedRow] = useState(() => rowMemory.get(LAST_ROW_KEY) ?? 0);
  const [focusedItem, setFocusedItem] = useState<CatalogItem | null>(null);
  const activeRow = Math.min(focusedRow, Math.max(0, rows.length - 1));
  const heroItem = useMemo(() => {
    if (focusedItem) return focusedItem;
    // Before the first focus: the card the memory points at, else the first one.
    const row = rows[activeRow];
    return row ? (row.items[rowMemory.get(row.id) ?? 0] ?? row.items[0] ?? null) : null;
  }, [focusedItem, rows, activeRow, rowMemory]);

  const offset = rows.slice(0, activeRow).reduce((sum, row) => sum + heightOf(row), 0);

  const retry = async (row: RowModel) => {
    try {
      setOverride(row.id, { kind: 'section', section: await readSection(row.id) });
    } catch {
      setOverride(row.id, { kind: 'failed' });
    }
  };

  // Removal from Continue Watching / Next Up.
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  const closeRemoval = useCallback(() => {
    setPending(null);
    dismiss.reset();
  }, [dismiss]);
  useContentBack(() => {
    if (!pendingRef.current) return false;
    closeRemoval();
    return true;
  });

  const confirmRemoval = () => {
    const surface = pending?.row.surface;
    if (!pending || !surface) return;
    const { row, item } = pending;
    dismiss.mutate(
      { surface, item },
      {
        onSuccess: () => {
          closeRemoval();
          // The card leaves at once; the row is then read again for what the server now holds.
          const source = query.data?.find((section) => section.id === row.id);
          if (source) {
            setOverride(row.id, {
              kind: 'section',
              section: {
                ...source,
                items: row.items.filter((card) => card.content_id !== item.content_id),
              },
            });
          }
          void retry(row);
        },
      },
    );
  };

  // The yellow key, or OK held down, on a card that can be removed asks about it. A tap of OK
  // opens the card as usual, but on release: until then it could still be a long press.
  const rowsRef = useRef(rows);
  const openRef = useRef(open);
  useEffect(() => {
    rowsRef.current = rows;
    openRef.current = open;
  });
  useEffect(() => {
    const press: { item: CatalogItem; fired: boolean; timer: ReturnType<typeof setTimeout> }[] = [];
    const findCard = (): PendingRemoval | null => {
      const focused = getCurrentFocusKey();
      if (!focused) return null;
      for (const row of rowsRef.current) {
        if (!row.surface) continue;
        const item = row.items.find((card) => focused === cardFocusKey(row.id, card.content_id));
        if (item) return { row, item };
      }
      return null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = getPlatform().mapKey(e);
      if (key === 'enter' && press.length > 0) {
        // Held: the repeats must not reach the card (or the dialog that the hold opened).
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if ((key !== 'yellow' && key !== 'enter') || pendingRef.current) return;
      const card = findCard();
      if (!card) return;
      e.preventDefault();
      if (key === 'yellow') {
        setPending(card);
        return;
      }
      e.stopImmediatePropagation();
      const entry = {
        item: card.item,
        fired: false,
        timer: setTimeout(() => {
          entry.fired = true;
          setPending(card);
        }, LONG_PRESS_MS),
      };
      press.push(entry);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (getPlatform().mapKey(e) !== 'enter') return;
      const entry = press.pop();
      if (!entry) return;
      clearTimeout(entry.timer);
      if (!entry.fired) openRef.current(entry.item);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      for (const entry of press) clearTimeout(entry.timer);
    };
  }, []);

  let body;
  if (query.isPending) {
    body = (
      <div role="status" aria-label={t('home.loading')} data-testid="home-loading">
        <HeroSkeleton />
        <div className="home-rows">
          <RowSkeleton shape="landscape" />
          <RowSkeleton shape="poster" />
          <RowSkeleton shape="poster" />
        </div>
      </div>
    );
  } else if (query.isError && !query.data) {
    body = (
      <div className="home-message" role="alert" data-testid="home-error">
        <p className="error">{t('home.error')}</p>
        <Button focusKey="home-retry" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="home-message" data-testid="home-empty">
        <h2 className="section-title">{t('home.empty.title')}</h2>
        <p className="note">{t('home.empty.text')}</p>
      </div>
    );
  } else {
    body = (
      <>
        <Hero item={heroItem} />
        <div
          className="home-rows"
          // Focus can scroll an overflow-hidden box on its own; the transform is the only scroll.
          onScroll={keepAtOrigin}
        >
          <FocusGroup
            focusKey="home-rows"
            enterable
            saveLastFocusedChild
            preferredChildFocusKey={rows[activeRow] ? rowFocusKey(rows[activeRow].id) : undefined}
            className="home-rows-inner"
            style={{ transform: `translateY(${-offset}px)` }}
          >
            {rows.map((row, index) => {
              const near =
                index >= activeRow - MOUNT_ROWS_BEFORE && index <= activeRow + MOUNT_ROWS_AFTER;
              if (row.failed) {
                return (
                  <section
                    key={row.id}
                    className="row-section row-error"
                    style={{ height: ROW_ERROR_HEIGHT }}
                    data-testid={`row-${row.id}`}
                  >
                    <h2 className="row-title" data-testid="row-title">
                      {row.title}
                    </h2>
                    <div className="row-error-body">
                      <p className="error" role="alert">
                        {t('home.sectionError')}
                      </p>
                      <Button
                        focusKey={`home-retry:${row.id}`}
                        onFocused={() => {
                          setFocusedRow(index);
                          rowMemory.set(LAST_ROW_KEY, index);
                        }}
                        onClick={() => void retry(row)}
                      >
                        {t('common.retry')}
                      </Button>
                    </div>
                  </section>
                );
              }
              return (
                <Row
                  key={row.id}
                  rowId={row.id}
                  title={row.title}
                  shape={row.shape}
                  items={row.items}
                  getKey={(item) => item.content_id}
                  memory={rowMemory}
                  mounted={near}
                  onExploreAll={
                    row.hasMore
                      ? () => onExploreSection({ id: row.id, title: row.title })
                      : undefined
                  }
                  onRowFocused={() => {
                    setFocusedRow(index);
                    rowMemory.set(LAST_ROW_KEY, index);
                  }}
                  onCardFocused={(item) => setFocusedItem(item)}
                  renderCard={(item, ctx) =>
                    row.shape === 'landscape' ? (
                      <LandscapeCard
                        item={item}
                        focusKey={ctx.focusKey}
                        onFocused={ctx.onFocused}
                        onOpen={open}
                      />
                    ) : (
                      <PosterCard
                        item={item}
                        focusKey={ctx.focusKey}
                        onFocused={ctx.onFocused}
                        onOpen={open}
                      />
                    )
                  }
                />
              );
            })}
          </FocusGroup>
        </div>
      </>
    );
  }

  return (
    <section className="home" data-testid="home">
      {body}
      {note}
      {pending?.row.surface ? (
        <RemoveDialog
          surface={pending.row.surface}
          title={cardTitle(pending.item)}
          busy={dismiss.isPending}
          failed={dismiss.isError}
          onCancel={closeRemoval}
          onConfirm={confirmRemoval}
        />
      ) : null}
    </section>
  );
}
