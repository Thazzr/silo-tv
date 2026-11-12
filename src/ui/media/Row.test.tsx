import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setFocus, getCurrentFocusKey } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { PosterCard } from './Cards';
import { rowHeight } from './layout';
import { cardFocusKey, EXPLORE_KEY, Row, rowFocusKey, type RowProps } from './Row';
import { FocusIndexMemory } from './scroll';

const items = (count: number, prefix = 'i') =>
  Array.from({ length: count }, (_, i) =>
    catalogItem({ content_id: `${prefix}${i + 1}`, title: `Item ${i + 1}` }),
  );

type Item = ReturnType<typeof items>[number];

function TestRow({
  rowId = 'r',
  data = items(20),
  onExploreAll,
  memory,
  initialIndex,
  metrics,
}: {
  rowId?: string;
  data?: Item[];
  onExploreAll?: () => void;
  memory?: FocusIndexMemory;
  initialIndex?: number;
  metrics?: RowProps<Item>['metrics'];
}) {
  return (
    <Row
      rowId={rowId}
      title={`Row ${rowId}`}
      shape="poster"
      items={data}
      getKey={(item) => item.content_id}
      memory={memory}
      initialIndex={initialIndex}
      metrics={metrics}
      onExploreAll={onExploreAll}
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

const key = (rowId: string, id: string) => cardFocusKey(rowId, id);
const track = (rowId = 'r') =>
  document.querySelector<HTMLElement>(`[data-testid="row-${rowId}"] [data-testid="row-track"]`)!;
const mountedCards = (rowId = 'r') =>
  document.querySelectorAll(`[data-testid="row-${rowId}"] [data-focus-key]`).length;
const focusAt = async (focusKey: string) => {
  await act(async () => {
    await setFocus(focusKey);
  });
};

describe('Row', () => {
  it('decides Left and Right by index, without the library searching; its ends still go to the library', async () => {
    renderWithSilo(<TestRow data={items(4)} onExploreAll={() => {}} />);
    await act(async () => {});
    const search = spySpatialSearch();
    try {
      await pressKey(KEY.right);
      await pressKey(KEY.right);
      await pressKey(KEY.left);
      expect(getCurrentFocusKey()).toBe(key('r', 'i2'));
      // Through to the Explore all card at the end.
      await pressKey(KEY.right);
      await pressKey(KEY.right);
      await pressKey(KEY.right);
      expect(getCurrentFocusKey()).toBe(cardFocusKey('r', EXPLORE_KEY));
      expect(search.count).toBe(0);
      // The last card has no right neighbour: the library is asked (and finds none).
      await pressKey(KEY.right);
      expect(search.count).toBeGreaterThan(0);
      expect(getCurrentFocusKey()).toBe(cardFocusKey('r', EXPLORE_KEY));
    } finally {
      search.restore();
    }
  });

  it('shows its title and moves the focus card by card with Left and Right', async () => {
    renderWithSilo(<TestRow />);
    expect(screen.getByRole('heading', { name: 'Row r' })).toBeInTheDocument();
    await focusAt(key('r', 'i1'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i2'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i3'));
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(key('r', 'i2'));
    // Left at the first card stays put.
    await pressKey(KEY.left);
    await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(key('r', 'i1'));
  });

  it('scrolls with a transform only when the focus leaves the screen, and back', async () => {
    renderWithSilo(<TestRow />);
    await focusAt(key('r', 'i1'));
    expect(track().style.transform).toBe('translateX(0px)');
    // Eight poster cards fit; moving to the eighth does not scroll.
    for (let i = 0; i < 7; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i8'));
    expect(track().style.transform).toBe('translateX(0px)');
    // The ninth needs one step of 205 px (185 + 20).
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i9'));
    expect(track().style.transform).toBe('translateX(-205px)');
    await pressKey(KEY.right);
    expect(track().style.transform).toBe('translateX(-410px)');
    // Back to the left edge the strip scrolls back.
    for (let i = 0; i < 9; i += 1) await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(key('r', 'i1'));
    expect(track().style.transform).toBe('translateX(0px)');
  });

  it('focuses a hovered, partly visible card without moving the strip; the next key scrolls as before', async () => {
    renderWithSilo(<TestRow />);
    await focusAt(key('r', 'i1'));
    // Eight poster cards fit; the ninth is mounted and peeks in at the right edge.
    const peeking = document.querySelector(`[data-focus-key="${key('r', 'i9')}"]`)!;
    fireEvent.mouseEnter(peeking);
    await waitFor(() => expect(getCurrentFocusKey()).toBe(key('r', 'i9')));
    await act(async () => {});
    expect(track().style.transform).toBe('translateX(0px)');
    // The next key moves on from the hovered card and brings the tenth into view.
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i10'));
    expect(track().style.transform).toBe('translateX(-410px)');
  });

  it('mounts only the cards near the viewport and follows the focus', async () => {
    renderWithSilo(<TestRow data={items(40)} />);
    // Eight visible plus four ahead.
    expect(mountedCards()).toBe(12);
    expect(document.querySelector(`[data-focus-key="${key('r', 'i30')}"]`)).toBeNull();
    await focusAt(key('r', 'i1'));
    for (let i = 0; i < 20; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i21'));
    expect(mountedCards()).toBeLessThanOrEqual(14);
    expect(document.querySelector(`[data-focus-key="${key('r', 'i21')}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-focus-key="${key('r', 'i1')}"]`)).toBeNull();
  });

  it('ends with an Explore all card when the row has more, and opens the row with OK', async () => {
    const onExploreAll = vi.fn();
    renderWithSilo(<TestRow data={items(3)} onExploreAll={onExploreAll} />);
    await focusAt(key('r', 'i3'));
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', EXPLORE_KEY));
    // It is the last card: Right goes nowhere.
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', EXPLORE_KEY));
    await pressKey(KEY.enter);
    expect(onExploreAll).toHaveBeenCalledTimes(1);
  });

  it('has no Explore all card without more cards', () => {
    renderWithSilo(<TestRow data={items(3)} />);
    expect(screen.queryByTestId('explore-all-art')).toBeNull();
    expect(mountedCards()).toBe(3);
  });

  it('remembers the focused card of each row: Down and Up land where the row was left', async () => {
    renderWithSilo(
      <>
        <TestRow rowId="a" data={items(10, 'a')} />
        <TestRow rowId="b" data={items(10, 'b')} />
      </>,
    );
    await focusAt(key('a', 'a1'));
    for (let i = 0; i < 4; i += 1) await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('a', 'a5'));
    await pressKey(KEY.down);
    // The second row was never visited: its first card.
    expect(getCurrentFocusKey()).toBe(key('b', 'b1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('b', 'b3'));
    await pressKey(KEY.up);
    expect(getCurrentFocusKey()).toBe(key('a', 'a5'));
    await pressKey(KEY.down);
    expect(getCurrentFocusKey()).toBe(key('b', 'b3'));
  });

  it('starts at the remembered card, scrolled into view, when it is shown again', () => {
    const memory = new FocusIndexMemory();
    memory.set('r', 12);
    renderWithSilo(<TestRow data={items(20)} memory={memory} />);
    expect(document.querySelector(`[data-focus-key="${key('r', 'i13')}"]`)).not.toBeNull();
    // Scrolled so that card 13 is the last visible one: first visible index 5.
    expect(track().style.transform).toBe('translateX(-1025px)');
  });

  it('writes the focused index into the memory', async () => {
    const memory = new FocusIndexMemory();
    renderWithSilo(<TestRow memory={memory} />);
    await focusAt(key('r', 'i1'));
    await pressKey(KEY.right);
    await pressKey(KEY.right);
    expect(memory.get('r')).toBe(2);
  });
});

describe('Row initialIndex', () => {
  it('starts on that card, scrolled into view, when the memory holds none', () => {
    renderWithSilo(<TestRow data={items(20)} initialIndex={12} />);
    expect(document.querySelector(`[data-focus-key="${key('r', 'i13')}"]`)).not.toBeNull();
    expect(track().style.transform).toBe('translateX(-1025px)');
  });

  it('is entered on that card when the focus comes into the row', async () => {
    renderWithSilo(<TestRow data={items(20)} initialIndex={12} />);
    await focusAt(rowFocusKey('r'));
    expect(getCurrentFocusKey()).toBe(key('r', 'i13'));
  });

  it('gives way to the remembered card', async () => {
    const memory = new FocusIndexMemory();
    memory.set('r', 2);
    renderWithSilo(<TestRow data={items(20)} initialIndex={12} memory={memory} />);
    expect(track().style.transform).toBe('translateX(0px)');
    await focusAt(rowFocusKey('r'));
    expect(getCurrentFocusKey()).toBe(key('r', 'i3'));
  });

  it('starts on the first card for a negative index, with an Explore all card at the end', async () => {
    renderWithSilo(<TestRow data={items(3)} initialIndex={-1} onExploreAll={() => {}} />);
    await focusAt(rowFocusKey('r'));
    expect(getCurrentFocusKey()).toBe(key('r', 'i1'));
  });

  it('clamps an index past the end to the last card', async () => {
    renderWithSilo(<TestRow data={items(5)} initialIndex={40} />);
    await focusAt(rowFocusKey('r'));
    expect(getCurrentFocusKey()).toBe(key('r', 'i5'));
  });

  it('clamps a remembered index past the end to the last card, and one just past it too', async () => {
    const memory = new FocusIndexMemory();
    memory.set('r', 5);
    renderWithSilo(<TestRow data={items(5)} memory={memory} />);
    await focusAt(rowFocusKey('r'));
    expect(getCurrentFocusKey()).toBe(key('r', 'i5'));
  });
});

describe('Row metrics', () => {
  const metrics = { width: 330, height: 186, captionOffset: 14, captionHeight: 135 };

  it('steps by the card width plus the gap and fits as many cards as that leaves room for', async () => {
    renderWithSilo(<TestRow data={items(12)} metrics={metrics} />);
    await focusAt(key('r', 'i1'));
    // 1920 - 2 x 80 insets + 40 gap, over 370 px a card: four whole cards.
    for (let i = 0; i < 3; i += 1) await pressKey(KEY.right);
    expect(track().style.transform).toBe('translateX(0px)');
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i5'));
    expect(track().style.transform).toBe('translateX(-370px)');
    const slot = document.querySelector<HTMLElement>('[data-testid="row-r"] .row-slot')!;
    expect(slot.style.left).toBe('0px');
    expect(slot.getAttribute('data-nav-rect')).toBe('0,0,330,186');
  });

  it('sizes the strip from the metrics, not from the shape', () => {
    renderWithSilo(<TestRow data={items(3)} metrics={metrics} />);
    const strip = document.querySelector<HTMLElement>('[data-testid="row-r"] .row-strip')!;
    // 186 + 14 + 135 of card block and 14 px padding above and below.
    expect(strip.style.height).toBe(`${186 + 14 + 135 + 28}px`);
  });

  it('is as tall as its cards need', () => {
    renderWithSilo(<TestRow data={items(3)} metrics={metrics} />);
    expect(screen.getByTestId('row-r').style.height).toBe(`${rowHeight(metrics)}px`);
    expect(rowHeight(metrics)).toBeGreaterThan(rowHeight('landscape'));
  });
});

describe('Row visibleCards', () => {
  it('scrolls once the focus passes the cards that fit the narrower column', async () => {
    renderWithSilo(
      <Row
        rowId="n"
        title="Narrow"
        shape="poster"
        items={items(12)}
        getKey={(item) => item.content_id}
        visibleCards={5}
        renderCard={(item, ctx) => (
          <PosterCard
            item={item}
            focusKey={ctx.focusKey}
            onFocused={ctx.onFocused}
            onOpen={() => {}}
          />
        )}
      />,
    );
    await act(async () => {
      await setFocus(cardFocusKey('n', 'i1'));
    });
    for (let i = 0; i < 5; i += 1) await pressKey(KEY.right);
    // The sixth card is focused: with five visible the strip has moved by one card (205 px).
    expect(screen.getByTestId('row-track').style.transform).toBe('translateX(-205px)');
  });
});
