import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { PosterCard } from './Cards';
import { Grid, gridCardKey } from './Grid';
import { GRID_ROW_PITCH } from './layout';
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
});
