import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { PosterCard } from './Cards';
import { Grid, gridCardKey } from './Grid';
import { GRID_ROW_PITCH, gridMetrics } from './layout';
import { FocusIndexMemory } from './scroll';

const makeItems = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) =>
    catalogItem({ content_id: `g${from + i + 1}`, title: `Grid ${from + i + 1}` }),
  );

type Item = ReturnType<typeof makeItems>[number];

function TestGrid({
  items,
  hasMore = false,
  loadingMore = false,
  onLoadMore = () => {},
  memory,
}: {
  items: Item[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  memory?: FocusIndexMemory;
}) {
  return (
    <Grid
      gridId="g"
      items={items}
      getKey={(item) => item.content_id}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      memory={memory}
      renderCard={(item, ctx) => (
        <PosterCard
          grid
          item={item}
          focusKey={ctx.focusKey}
          autoFocus={ctx.autoFocus}
          onFocused={ctx.onFocused}
          onOpen={() => {}}
        />
      )}
    />
  );
}

/** Pages of 30 from a pretend server with `total` items; the grid asks for the next one. */
function PagedGrid({ total, onPage }: { total: number; onPage: () => void }) {
  const [count, setCount] = useState(30);
  return (
    <TestGrid
      items={makeItems(0, count)}
      hasMore={count < total}
      onLoadMore={() => {
        onPage();
        setCount((c) => Math.min(total, c + 30));
      }}
    />
  );
}

const key = (id: string) => gridCardKey('g', id);
const track = () => screen.getByTestId('grid-track');
const mounted = () => document.querySelectorAll('[data-focus-key]').length;
const down = async (times: number) => {
  for (let i = 0; i < times; i += 1) await pressKey(KEY.down);
};
const focusAt = async (focusKey: string) => {
  await act(async () => {
    await setFocus(focusKey);
  });
};

describe('Grid', () => {
  it('lands on the last card when Down leaves a short last row, without the library searching', async () => {
    // 8 cards: a full row and a last row of two.
    renderWithSilo(<TestGrid items={makeItems(0, 8)} />);
    await act(async () => {});
    await focusAt(key('g5'));
    const search = spySpatialSearch();
    try {
      await pressKey(KEY.down);
      expect(getCurrentFocusKey()).toBe(key('g8'));
      expect(search.count).toBe(0);
    } finally {
      search.restore();
    }
  });

  it('decides arrows by index, without the library searching, except at the edges', async () => {
    // 15 cards: two full rows and a last row of three.
    renderWithSilo(<TestGrid items={makeItems(0, 15)} />);
    await act(async () => {});
    const search = spySpatialSearch();
    try {
      await pressKey(KEY.right);
      await pressKey(KEY.down);
      await pressKey(KEY.left);
      await pressKey(KEY.up);
      expect(getCurrentFocusKey()).toBe(key('g1'));
      expect(search.count).toBe(0);
      // Down from the last column of the second row lands on the last card of the short row.
      await focusAt(key('g12'));
      await pressKey(KEY.down);
      expect(getCurrentFocusKey()).toBe(key('g15'));
      // Right from the last card, and Up from the first row: the library decides.
      await pressKey(KEY.right);
      expect(search.count).toBeGreaterThan(0);
      const before = search.count;
      await focusAt(key('g3'));
      await pressKey(KEY.up);
      expect(search.count).toBeGreaterThan(before);
    } finally {
      search.restore();
    }
  });

  it('focuses the first card and moves in six columns', async () => {
    renderWithSilo(<TestGrid items={makeItems(0, 30)} />);
    await act(async () => {});
    expect(getCurrentFocusKey()).toBe(key('g1'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('g2'));
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('g8'));
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe(key('g2'));
  });

  it('mounts only the rows near the viewport and scrolls one row per Down with a transform', async () => {
    renderWithSilo(<TestGrid items={makeItems(0, 120)} />);
    await act(async () => {});
    // Rows 0-3 of 20.
    expect(mounted()).toBe(24);
    expect(track().style.transform).toBe('translateY(0px)');
    await down(5);
    expect(getCurrentFocusKey()).toBe(key('g31'));
    expect(track().style.transform).toBe(`translateY(${-5 * GRID_ROW_PITCH}px)`);
    // The first rows are gone, the ones ahead are there.
    expect(document.querySelector(`[data-focus-key="${key('g1')}"]`)).toBeNull();
    expect(document.querySelector(`[data-focus-key="${key('g49')}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-focus-key="${key('g55')}"]`)).toBeNull();
    expect(mounted()).toBeLessThanOrEqual(30);
  });

  it('focuses a hovered card in a lower row without moving the grid; the next key scrolls as before', async () => {
    renderWithSilo(<TestGrid items={makeItems(0, 120)} />);
    await act(async () => {});
    await focusAt(key('g1'));
    // Row 2 sits below the first row; the window is scrolled to row 0.
    fireEvent.mouseEnter(document.querySelector(`[data-focus-key="${key('g13')}"]`)!);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(key('g13')));
    await act(async () => {});
    expect(track().style.transform).toBe('translateY(0px)');
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('g19'));
    expect(track().style.transform).toBe(`translateY(${-3 * GRID_ROW_PITCH}px)`);
  });

  it('asks for the next page when the focus is within three rows of the end, not before', async () => {
    const onLoadMore = vi.fn();
    renderWithSilo(<TestGrid items={makeItems(0, 60)} hasMore onLoadMore={onLoadMore} />);
    await act(async () => {});
    await down(6);
    expect(getCurrentFocusKey()).toBe(key('g37'));
    expect(onLoadMore).not.toHaveBeenCalled();
    await down(1);
    expect(getCurrentFocusKey()).toBe(key('g43'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('asks at once when the first page is short', async () => {
    const onLoadMore = vi.fn();
    renderWithSilo(<TestGrid items={makeItems(0, 12)} hasMore onLoadMore={onLoadMore} />);
    await act(async () => {});
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('loads page after page and stops at the last one', async () => {
    const onPage = vi.fn();
    renderWithSilo(<PagedGrid total={70} onPage={onPage} />);
    await act(async () => {});
    // 30 cards: the focus is on the first, five rows from the end.
    expect(onPage).not.toHaveBeenCalled();
    await down(2);
    expect(onPage).toHaveBeenCalledTimes(1);
    // 60 cards now; three rows from the end the last page (10 cards) is asked for.
    await down(5);
    expect(onPage).toHaveBeenCalledTimes(2);
    // 70 cards are all there is: no further page is asked for, wherever the focus goes.
    await down(8);
    expect(getCurrentFocusKey()).toBe(key('g67'));
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('does not ask while a page is loading, and shows a row of skeletons for it', async () => {
    const onLoadMore = vi.fn();
    renderWithSilo(
      <TestGrid items={makeItems(0, 12)} hasMore loadingMore onLoadMore={onLoadMore} />,
    );
    await act(async () => {});
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('card-skeleton')).toHaveLength(6);
  });

  it('starts at the remembered card, scrolled to its row', async () => {
    const memory = new FocusIndexMemory();
    memory.set('g', 30);
    renderWithSilo(<TestGrid items={makeItems(0, 120)} memory={memory} />);
    await act(async () => {});
    expect(getCurrentFocusKey()).toBe(key('g31'));
    expect(track().style.transform).toBe(`translateY(${-5 * GRID_ROW_PITCH}px)`);
  });

  it('writes the focused index into the memory', async () => {
    const memory = new FocusIndexMemory();
    renderWithSilo(<TestGrid items={makeItems(0, 30)} memory={memory} />);
    await act(async () => {});
    await focusAt(key('g1'));
    await pressKey(KEY.down);
    expect(memory.get('g')).toBe(6);
  });

  it('puts the viewport back when focus scrolls the clipping box on its own', async () => {
    renderWithSilo(<TestGrid items={makeItems(0, 30)} />);
    await act(async () => {});
    const viewport = screen.getByTestId('grid-viewport');
    viewport.scrollTop = 33;
    fireEvent.scroll(viewport);
    expect(viewport.scrollTop).toBe(0);
  });

  it('gives the track the width of its six columns, so the navigation sees where the grid is', () => {
    renderWithSilo(<TestGrid items={makeItems(0, 8)} />);
    // 6 posters of 260 px and 5 gaps of 40 px; without it the track is as wide as nothing.
    expect(screen.getByTestId('grid-track').style.width).toBe('1760px');
  });
});

describe('Grid with a layout of four columns', () => {
  const layout = gridMetrics(4, { width: 236, height: 354 }, 40, 24);

  function FourGrid() {
    return (
      <Grid
        gridId="g"
        items={makeItems(0, 10)}
        getKey={(item) => item.content_id}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        layout={layout}
        renderCard={(item, ctx) => (
          <PosterCard
            grid
            item={item}
            focusKey={ctx.focusKey}
            onFocused={ctx.onFocused}
            onOpen={() => {}}
          />
        )}
      />
    );
  }

  it('places the cards in four columns at the layout pitch', async () => {
    renderWithSilo(<FourGrid />);
    const slots = document.querySelectorAll<HTMLElement>('.grid-slot');
    expect(slots[3]!.style.left).toBe('828px');
    expect(slots[4]!.style.left).toBe('0px');
    expect(slots[4]!.style.top).toBe(`${layout.rowPitch}px`);
    expect(slots[0]!.dataset.navRect).toBe('0,0,236,354');
    expect(track().style.width).toBe('1064px');
    expect(track().style.left).toBe('24px');
  });

  it('moves Down by four cards and stops Right at the fourth column', async () => {
    renderWithSilo(<FourGrid />);
    await focusAt(key('g1'));
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('g5'));
    await focusAt(key('g4'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('g4'));
  });
});

describe('Grid by position', () => {
  /** `total` positions of which only the given range is loaded; the rest are `undefined`. */
  const sparse = (total: number, loaded: [number, number]) => {
    const list: (Item | undefined)[] = Array.from({ length: total });
    makeItems(loaded[0], loaded[1]).forEach((item, i) => {
      list[loaded[0] + i] = item;
    });
    return list;
  };

  function PositionGrid({
    items,
    jumpTo,
    onWindow,
    memory,
  }: {
    items: (Item | undefined)[];
    jumpTo?: { index: number } | null;
    onWindow?: (window: { top: number; first: number; end: number }) => void;
    memory?: FocusIndexMemory;
  }) {
    return (
      <Grid
        gridId="g"
        items={items}
        getKey={(item) => item.content_id}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        memory={memory}
        onWindow={onWindow}
        jumpTo={jumpTo}
        renderCard={(item, ctx) => (
          <PosterCard
            grid
            item={item}
            focusKey={ctx.focusKey}
            onFocused={ctx.onFocused}
            onOpen={() => {}}
          />
        )}
      />
    );
  }

  it('is as long as the list and shows a skeleton card for every title that is not loaded', async () => {
    renderWithSilo(<PositionGrid items={sparse(60, [0, 12])} />);
    await act(async () => {});
    expect(track().style.height).toBe(`${10 * GRID_ROW_PITCH}px`);
    // Rows 0 to 3 are mounted: two of cards, two of skeletons.
    expect(screen.getAllByTestId('card-skeleton')).toHaveLength(12);
    expect(screen.getAllByRole('button', { name: /Grid 12/ }).length).toBeGreaterThan(0);
  });

  it('keeps the focus where it is when Down would land on a title that is not loaded', async () => {
    renderWithSilo(<PositionGrid items={sparse(60, [0, 12])} />);
    await act(async () => {});
    await focusAt(key('g7'));
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('g7'));
  });

  /** A grid with a plain button that jumps it to `index`, as the alphabet rail does. */
  function JumpGrid({
    index,
    ...rest
  }: { index: number } & Omit<Parameters<typeof PositionGrid>[0], 'jumpTo'>) {
    const [jump, setJump] = useState<{ index: number } | null>(null);
    return (
      <>
        <button type="button" data-testid="jump" onClick={() => setJump({ index })} />
        <PositionGrid {...rest} jumpTo={jump} />
      </>
    );
  }

  it('scrolls its row to the top on a jump, and the focused card stays where it was', async () => {
    const memory = new FocusIndexMemory();
    renderWithSilo(<JumpGrid items={sparse(60, [0, 60])} memory={memory} index={31} />);
    await act(async () => {});
    await focusAt(key('g2'));
    fireEvent.click(screen.getByTestId('jump'));
    // Index 31 is in row 5.
    await waitFor(() =>
      expect(track().style.transform).toBe(`translateY(${-5 * GRID_ROW_PITCH}px)`),
    );
    expect(getCurrentFocusKey()).toBe(key('g2'));
    expect(memory.get('g')).toBe(31);
  });

  it('reports the top row and the rows that are mounted around it', async () => {
    const seen = vi.fn();
    renderWithSilo(<JumpGrid items={sparse(60, [0, 60])} onWindow={seen} index={30} />);
    await act(async () => {});
    await focusAt(key('g2'));
    expect(seen).toHaveBeenLastCalledWith({ top: 0, first: 0, end: 24 });
    fireEvent.click(screen.getByTestId('jump'));
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith({ top: 30, first: 24, end: 54 }));
  });
});
