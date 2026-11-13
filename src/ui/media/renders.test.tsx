import { act } from '@testing-library/react';
import { Profiler, useCallback, useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { PosterCard } from './Cards';
import { CatalogRow } from './CatalogRow';
import { Grid, gridCardKey } from './Grid';
import { prefetchImage } from './prefetch';
import { cardFocusKey, Row, type RowProps } from './Row';
import { prefetchIndices } from './scroll';
import type { CatalogItem } from './cardInfo';

// The guards of the scroll performance work: a focus move must not redraw cards that did not
// change (on the TV every redrawn card is main-thread time per key press), and the pictures just
// beyond the mounted cards are fetched ahead.

const { commits } = vi.hoisted(() => ({ commits: new Map<string, number>() }));
/** Commits per Profiler id: a Profiler reports only when something inside it was rendered. */
const onRender = (id: string) => commits.set(id, (commits.get(id) ?? 0) + 1);

vi.mock('./prefetch', () => ({ prefetchImage: vi.fn() }));
// Every Row reports its own commits as "row:<id>". The Profiler sits inside the wrapper, which only
// renders when the row's parent re-renders it (the rows are memoised), so a row that was skipped
// reports nothing, while a row that re-renders for its own focus state does.
vi.mock('./Row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./Row')>();
  const Counted = (props: RowProps<unknown>) => (
    <Profiler id={`row:${props.rowId}`} onRender={onRender}>
      <actual.Row {...props} />
    </Profiler>
  );
  return { ...actual, Row: Counted };
});

const items = (prefix: string, count: number): CatalogItem[] =>
  Array.from({ length: count }, (_, i) =>
    catalogItem({
      content_id: `${prefix}${i + 1}`,
      title: `${prefix} ${i + 1}`,
      poster_url: `/img/${prefix}${i + 1}.webp`,
    }),
  );

const commitsOf = (prefix: string) =>
  [...commits].filter(([id]) => id.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0);
const focusAt = (focusKey: string) =>
  act(async () => {
    await setFocus(focusKey);
  });

beforeEach(() => {
  commits.clear();
  vi.mocked(prefetchImage).mockClear();
});

/**
 * A screen like Home: it re-renders whenever a card takes the focus (it shows the focused title,
 * as the hero does) and hands its rows stable props.
 */
function Screen({ rows }: { rows: { id: string; items: CatalogItem[] }[] }) {
  const [focused, setFocused] = useState<CatalogItem | null>(null);
  const open = useCallback(() => {}, []);
  const explore = useCallback(() => {}, []);
  const rowFocused = useCallback(() => {}, []);
  const cardFocused = useCallback((item: CatalogItem) => setFocused(item), []);
  return (
    <>
      <p data-testid="focused">{focused?.title}</p>
      {rows.map((row, index) => (
        <CatalogRow
          key={row.id}
          rowId={row.id}
          title={row.id}
          shape="poster"
          items={row.items}
          hasMore
          mounted
          prefetchRow={false}
          rowIndex={index}
          onOpen={open}
          onPlay={open}
          onExploreAll={explore}
          onRowFocused={rowFocused}
          onCardFocused={cardFocused}
        />
      ))}
    </>
  );
}

describe('focus moves redraw nothing that did not change', () => {
  it('a move inside a row redraws only that row, and none of the other rows', async () => {
    renderWithSilo(
      <Screen
        rows={[
          { id: 'a', items: items('a', 20) },
          { id: 'b', items: items('b', 20) },
          { id: 'c', items: items('c', 20) },
        ]}
      />,
    );
    await focusAt(cardFocusKey('a', 'a1'));
    commits.clear();

    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('a', 'a2'));
    expect(commitsOf('row:a')).toBeGreaterThan(0);
    expect(commitsOf('row:b')).toBe(0);
    expect(commitsOf('row:c')).toBe(0);

    // The next row takes the focus: the two rows involved, not the third.
    commits.clear();
    await focusAt(cardFocusKey('b', 'b1'));
    expect(commitsOf('row:c')).toBe(0);
    expect(commitsOf('row:b')).toBeGreaterThan(0);
  });

  it('a move inside a row redraws only the cards that lose and get the focus', async () => {
    const data = items('r', 20);
    renderWithSilo(
      <Row
        rowId="r"
        title="Row r"
        shape="poster"
        items={data}
        getKey={(item) => item.content_id}
        renderCard={(item, ctx) => (
          <Profiler id={`card:${item.content_id}`} onRender={onRender}>
            <PosterCard
              item={item}
              focusKey={ctx.focusKey}
              onFocused={ctx.onFocused}
              onOpen={() => {}}
            />
          </Profiler>
        )}
      />,
    );
    await focusAt(cardFocusKey('r', 'r1'));
    commits.clear();
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('r', 'r3'));
    // The navigation redraws the card that loses the focus and the one that gets it (their own
    // focus state): r1 and r2 on the first press, r2 and r3 on the second. No other card is touched,
    // and none is drawn again for the row's own re-render.
    const touched = [...commits].filter(([id]) => id.startsWith('card:')).map(([id]) => id);
    expect(touched.sort()).toEqual(['card:r1', 'card:r2', 'card:r3']);
    expect(commitsOf('card:')).toBeLessThanOrEqual(4);
  });

  it('a move inside the grid redraws at most the two cards whose autoFocus flag flips', async () => {
    const data = items('g', 60);
    renderWithSilo(
      <Grid
        gridId="g"
        items={data}
        getKey={(item) => item.content_id}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        renderCard={(item, ctx) => (
          <Profiler id={`card:${item.content_id}`} onRender={onRender}>
            <PosterCard
              grid
              item={item}
              focusKey={ctx.focusKey}
              autoFocus={ctx.autoFocus}
              onFocused={ctx.onFocused}
              onOpen={() => {}}
            />
          </Profiler>
        )}
      />,
    );
    await focusAt(gridCardKey('g', 'g1'));
    commits.clear();
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(gridCardKey('g', 'g2'));
    expect(commitsOf('card:')).toBeLessThanOrEqual(2);
  });
});

function ArtRow({
  data,
  mounted = true,
  prefetchRow = false,
}: {
  data: CatalogItem[];
  mounted?: boolean;
  prefetchRow?: boolean;
}): ReactNode {
  return (
    <Row
      rowId="r"
      title="Row r"
      shape="poster"
      items={data}
      getKey={(item) => item.content_id}
      mounted={mounted}
      prefetchRow={prefetchRow}
      artUrl={(item) => `/art/${item.content_id}`}
      renderCard={(item, ctx) => (
        <PosterCard
          item={item}
          focusKey={ctx.focusKey}
          onFocused={ctx.onFocused}
          onOpen={() => {}}
        />
      )}
    />
  );
}

const fetched = () => vi.mocked(prefetchImage).mock.calls.map(([url]) => url);

describe('pictures are fetched before their cards are seen', () => {
  it('fetches the six pictures past the mounted cards, to the right at first', () => {
    // Eight cards are visible, four more are mounted to the right: cards 1 to 12.
    renderWithSilo(<ArtRow data={items('r', 20)} />);
    expect(fetched()).toEqual(['r13', 'r14', 'r15', 'r16', 'r17', 'r18'].map((id) => `/art/${id}`));
  });

  it('fetches to the left when the focus travels left', async () => {
    renderWithSilo(<ArtRow data={items('r', 20)} />);
    await focusAt(cardFocusKey('r', 'r1'));
    for (let i = 0; i < 19; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('r', 'r20'));
    vi.mocked(prefetchImage).mockClear();
    // Back to card 11: the window scrolls left and the six pictures before it are fetched.
    for (let i = 0; i < 9; i += 1) await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(cardFocusKey('r', 'r11'));
    expect(fetched()).toContain('/art/r4');
    expect(fetched()).not.toContain('/art/r20');
  });

  it('fetches the first pictures of a row that is next in line but not mounted', () => {
    renderWithSilo(<ArtRow data={items('r', 20)} mounted={false} prefetchRow />);
    // Eight visible plus the four that a mounted row keeps ready to the right.
    expect(fetched()).toEqual(Array.from({ length: 12 }, (_, i) => `/art/r${i + 1}`));
  });

  it('fetches nothing for a row that is neither mounted nor next in line', () => {
    renderWithSilo(<ArtRow data={items('r', 20)} mounted={false} />);
    expect(fetched()).toEqual([]);
  });

  it('mounted cards load their pictures eagerly, not lazily', () => {
    renderWithSilo(<ArtRow data={items('r', 20)} />);
    const images = document.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img.getAttribute('loading')).toBeNull();
  });

  it('prefetchIndices: the indices past the window on the side of travel, within the list', () => {
    expect(prefetchIndices([0, 11], 20, 1, 6)).toEqual([12, 13, 14, 15, 16, 17]);
    expect(prefetchIndices([10, 19], 20, 1, 6)).toEqual([]);
    expect(prefetchIndices([10, 19], 20, -1, 6)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(prefetchIndices([2, 11], 20, -1, 6)).toEqual([0, 1]);
    expect(prefetchIndices([], 20, 1, 6)).toEqual([]);
  });
});
