import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StartIntent } from '../../playback/resume';
import { Button } from '../../app/ui';
import { FocusGroup, getCurrentFocusKey, setFocus, type ArrowHandler } from '../../app/nav';
import { useContentBack } from '../../app/shell/ShellBack';
import { useT } from '../../i18n';
import {
  BoxSetCard,
  Grid,
  GridSkeleton,
  keepAtOrigin,
  PersonCard,
  PosterCard,
  Row,
  useArtUrl,
  type CatalogBoxSet,
  type CatalogItem,
} from '../../ui/media';
import { useBranding } from '../branding/queries';
import type { BoxSetTarget } from '../boxset/boxSetMemory';
import type { DetailTarget } from '../detail/detailMemory';
import { initials } from '../detail/info';
import { useItemOpener } from '../home/useItemOpener';
import { PillRow } from '../library/PillRow';
import { useSearchCapabilities } from '../library/queries';
import type { Person } from '../person/info';
import type { PersonTarget } from '../person/personMemory';
import {
  blockOf,
  BOX_SET_ROW_ID,
  PEOPLE_ROW_ID,
  SEARCH_GRID_ID,
  SEARCH_KEYBOARD_KEY,
  SEARCH_PILL_PREFIX,
  SEARCH_PILLS_KEY,
  SEARCH_RETRY_KEY,
  searchArrows,
  type PresentBlocks,
} from './arrows';
import {
  countLabel,
  normaliseQuery,
  resultSubtitle,
  SEGMENT_LABELS,
  SEGMENTS,
  wantsPeople,
  type Segment,
} from './info';
import { Keyboard } from './Keyboard';
import { applyKey, type KeySpec } from './keys';
import {
  SEARCH_GRID,
  SEARCH_PEOPLE_VISIBLE,
  SEARCH_ROW_INSET,
  fieldShift,
  SEARCH_ROW_VISIBLE,
  searchScrollOffset,
  type SearchZone,
} from './layout';
import { useSearchBoxSets, useSearchPeople, useSearchTitles } from './queries';
import type { SearchMemory } from './searchMemory';

export interface SearchScreenProps {
  memory: SearchMemory;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onOpenPerson: (target: PersonTarget) => void;
  onOpenBoxSet: (target: BoxSetTarget) => void;
}

const boxSetKey = (boxSet: CatalogBoxSet) => boxSet.id;
const personKey = (person: Person) => person.id;
const titleKey = (item: CatalogItem) => item.content_id;

interface CardContext {
  focusKey: string;
  onFocused: () => void;
}

/**
 * The content of the Search tab: a query field with an on-screen keyboard on the left, and on the
 * right the segments, the box sets and people that match, the number of results and the titles.
 * Typing searches 300 ms after the last key; the keyboard keeps the focus while it does. The
 * results are a column of blocks that scrolls so the focused block is on screen: with the focus
 * in the titles the rows above them make way. Text, segment and the focused card are kept in
 * `memory`, and the results come back from the query cache, so a page opened from a result returns
 * to the same screen.
 */
export function SearchScreen({
  memory,
  onPlay,
  onOpenDetail,
  onOpenPerson,
  onOpenBoxSet,
}: SearchScreenProps) {
  const t = useT();
  const branding = useBranding();
  const capabilities = useSearchCapabilities();
  const { open } = useItemOpener({ onPlay, onOpenDetail });

  const [text, setText] = useState(() => memory.query);
  const [segment, setSegment] = useState<Segment>(() => memory.segment);
  const [zone, setZone] = useState<SearchZone>('top');
  const query = normaliseQuery(text);
  const hasQuery = query !== '';

  const titles = useSearchTitles(query, segment);
  const boxSets = useSearchBoxSets(query, segment);
  const people = useSearchPeople(query, segment);
  const items = useMemo(
    () => titles.data?.pages.flatMap((page) => page.items) ?? [],
    [titles.data],
  );
  const lastPage = titles.data?.pages[titles.data.pages.length - 1];

  const searching =
    hasQuery && (titles.capabilitiesPending || titles.isPending || titles.isPlaceholderData);
  const failed = hasQuery && titles.isError && items.length === 0;
  const noMatch =
    hasQuery &&
    !searching &&
    !failed &&
    items.length === 0 &&
    boxSets.items.length === 0 &&
    people.items.length === 0 &&
    !boxSets.loading &&
    !people.loading;

  // --- The text of the field: left-aligned, shifted left only when it is wider than the field ---
  const boxRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const run = runRef.current;
    if (box && run) setShift(fieldShift(run.offsetWidth, box.clientWidth));
  }, [text]);

  // --- Typing ---------------------------------------------------------------------------------
  const textRef = useRef(text);
  const press = useCallback(
    (key: KeySpec) => {
      const next = applyKey(textRef.current, key);
      if (next === textRef.current) return;
      textRef.current = next;
      memory.setQuery(next);
      setText(next);
      setZone('top');
    },
    [memory],
  );
  const keyFocused = useCallback(
    (key: KeySpec) => {
      memory.rememberKey(key.id);
      setZone('top');
    },
    [memory],
  );
  const pickSegment = useCallback(
    (id: string) => {
      memory.setSegment(id as Segment);
      setSegment(id as Segment);
      setZone('top');
    },
    [memory],
  );
  const inTop = useCallback(() => setZone('top'), []);
  const inGrid = useCallback(() => setZone('grid'), []);

  // --- Arrow keys and Back ----------------------------------------------------------------------
  const present: PresentBlocks = {
    pills: hasQuery,
    boxSets: boxSets.items.length > 0,
    people: people.items.length > 0,
    grid: items.length > 0,
    retry: failed,
  };
  const presentRef = useRef(present);
  useEffect(() => {
    presentRef.current = present;
  });
  const arrows = useCallback<ArrowHandler>(
    (direction, fromKey) => searchArrows(() => presentRef.current)(direction, fromKey),
    [],
  );

  useContentBack(() => {
    const focused = getCurrentFocusKey();
    const block = focused ? blockOf(focused) : null;
    // From the results to the keyboard; from the keyboard the shell's rule applies.
    if (block === null || block === 'keyboard') return false;
    void setFocus(SEARCH_KEYBOARD_KEY);
    return true;
  });

  // --- Opening a result --------------------------------------------------------------------------
  const latest = useRef({ open, onOpenPerson, onOpenBoxSet });
  useEffect(() => {
    latest.current = { open, onOpenPerson, onOpenBoxSet };
  });
  const openTitle = useCallback((item: CatalogItem) => latest.current.open(item), []);
  const openBoxSet = useCallback(
    (boxSet: CatalogBoxSet) =>
      latest.current.onOpenBoxSet({
        boxSetId: boxSet.id,
        libraryId: boxSet.library_id,
        boxSetTitle: boxSet.title,
        backdropUrl: boxSet.backdrop_url,
      }),
    [],
  );
  const openPerson = useCallback(
    (person: Person) =>
      latest.current.onOpenPerson({ personId: person.id, personName: person.name }),
    [],
  );
  const artUrl = useArtUrl('poster');
  const renderBoxSet = useCallback(
    (boxSet: CatalogBoxSet, ctx: CardContext) => (
      <BoxSetCard
        boxSet={boxSet}
        focusKey={ctx.focusKey}
        onFocused={ctx.onFocused}
        onOpen={openBoxSet}
      />
    ),
    [openBoxSet],
  );
  const renderPerson = useCallback(
    (person: Person, ctx: CardContext) => (
      <PersonCard
        name={person.name}
        photo={person.photo_url}
        thumbhash={person.photo_thumbhash}
        initials={initials(person.name)}
        compact
        focusKey={ctx.focusKey}
        onFocused={ctx.onFocused}
        onOpen={() => openPerson(person)}
      />
    ),
    [openPerson],
  );
  const renderTitle = useCallback(
    (item: CatalogItem, ctx: CardContext) => (
      <PosterCard
        grid
        item={item}
        subtitle={resultSubtitle(item)}
        focusKey={ctx.focusKey}
        onFocused={() => {
          ctx.onFocused();
          inGrid();
        }}
        onOpen={openTitle}
      />
    ),
    [inGrid, openTitle],
  );

  // --- The results column -----------------------------------------------------------------------
  const requestKey = `${query}|${segment}`;
  const offset = searchScrollOffset(zone, boxSets.items.length > 0, people.items.length > 0);
  let count = '';
  if (searching) count = t('search.searching');
  else if (lastPage && items.length > 0) {
    count = countLabel(lastPage.total, lastPage.total_exact, t);
  }

  let body = null;
  if (searching && items.length === 0) {
    body = <GridSkeleton layout={SEARCH_GRID} />;
  } else if (failed) {
    body = (
      <div className="search-message" role="alert" data-testid="search-error">
        <p className="error">{t('search.error')}</p>
        <Button focusKey={SEARCH_RETRY_KEY} onClick={() => void titles.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (noMatch) {
    body = (
      <div className="search-message" data-testid="search-empty">
        <h2 className="search-message-title">{t('search.empty.title')}</h2>
        <p className="note">{t('search.empty.text')}</p>
      </div>
    );
  } else if (items.length > 0) {
    body = (
      <Grid
        key={requestKey}
        gridId={SEARCH_GRID_ID}
        items={items}
        getKey={titleKey}
        hasMore={titles.hasNextPage}
        loadingMore={titles.isFetchingNextPage}
        onLoadMore={() => void titles.fetchNextPage()}
        memory={memory.indices}
        artUrl={artUrl}
        layout={SEARCH_GRID}
        renderCard={renderTitle}
      />
    );
  }

  const results = hasQuery ? (
    <>
      <PillRow
        focusKey={SEARCH_PILLS_KEY}
        keyPrefix={SEARCH_PILL_PREFIX}
        label={t('search.segments')}
        items={SEGMENTS.map((id) => ({ id, label: t(SEGMENT_LABELS[id]) }))}
        selected={segment}
        onPick={pickSegment}
        onFocused={inTop}
        className="search-pills"
        testId="search-segments"
      />
      <div className="search-scroll" data-transform-scrolled="page" onScroll={keepAtOrigin}>
        <div
          className="search-page"
          data-testid="search-page"
          style={{ transform: `translateY(${-offset}px)` }}
        >
          {boxSets.items.length > 0 ? (
            <Row
              key={`boxsets|${requestKey}`}
              rowId={BOX_SET_ROW_ID}
              title={t('search.boxSets')}
              shape="poster"
              items={boxSets.items}
              getKey={boxSetKey}
              memory={memory.indices}
              inset={SEARCH_ROW_INSET}
              visibleCards={SEARCH_ROW_VISIBLE}
              onRowFocused={inTop}
              renderCard={renderBoxSet}
            />
          ) : null}
          {people.items.length > 0 ? (
            <Row
              key={`people|${requestKey}`}
              rowId={PEOPLE_ROW_ID}
              title={t('search.people')}
              shape="person"
              items={people.items}
              getKey={personKey}
              memory={memory.indices}
              inset={SEARCH_ROW_INSET}
              visibleCards={SEARCH_PEOPLE_VISIBLE}
              onRowFocused={inTop}
              renderCard={renderPerson}
            />
          ) : null}
          <p className="search-count" role="status" data-testid="search-count">
            {count}
          </p>
          {body}
        </div>
      </div>
    </>
  ) : (
    <div className="search-hint" data-testid="search-hint">
      <h2 className="search-hint-title">
        {t('search.hint.title', { server: branding.serverName })}
      </h2>
      <p className="note">
        {t(wantsPeople('all', capabilities.data) ? 'search.hint.textPeople' : 'search.hint.text')}
      </p>
    </div>
  );

  return (
    <FocusGroup
      focusKey="search-content"
      enterable
      className="search"
      onArrow={arrows}
      data-testid="search"
    >
      <div className="search-left">
        <div className="search-field" data-testid="search-field" aria-label={t('search.field')}>
          <span ref={boxRef} className="search-field-inner">
            <span
              ref={runRef}
              className="search-run"
              data-testid="search-run"
              style={{ transform: `translateX(${-shift}px)` }}
            >
              {text === '' ? (
                <>
                  <span className="search-caret is-first" aria-hidden="true" />
                  <span className="search-placeholder">{t('search.placeholder')}</span>
                </>
              ) : (
                <>
                  <span className="search-text" data-testid="search-text">
                    {text}
                  </span>
                  <span className="search-caret" aria-hidden="true" />
                </>
              )}
            </span>
          </span>
        </div>
        <Keyboard startKey={memory.lastKey ?? 'a'} onPress={press} onFocused={keyFocused} />
      </div>
      <div className="search-results" data-testid="search-results">
        {results}
      </div>
    </FocusGroup>
  );
}
