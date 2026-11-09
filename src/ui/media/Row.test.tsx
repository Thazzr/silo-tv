import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setFocus, getCurrentFocusKey } from '../../app/nav';
import { spySpatialSearch } from '../../app/nav/testing';
import { catalogItem } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { renderWithSilo } from '../../test/renderFlow';
import { PosterCard } from './Cards';
import { cardFocusKey, EXPLORE_KEY, Row } from './Row';
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
}: {
  rowId?: string;
  data?: Item[];
  onExploreAll?: () => void;
  memory?: FocusIndexMemory;
}) {
  return (
    <Row
      rowId={rowId}
      title={`Row ${rowId}`}
      shape="poster"
      items={data}
      getKey={(item) => item.content_id}
      memory={memory}
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
    // The ninth needs one step of 216 px (176 + 40).
    await pressKey(KEY.right);
    expect(getCurrentFocusKey()).toBe(key('r', 'i9'));
    expect(track().style.transform).toBe('translateX(-216px)');
    await pressKey(KEY.right);
    expect(track().style.transform).toBe('translateX(-432px)');
    // Back to the left edge the strip scrolls back.
    for (let i = 0; i < 9; i += 1) await pressKey(KEY.left);
    expect(getCurrentFocusKey()).toBe(key('r', 'i1'));
    expect(track().style.transform).toBe('translateX(0px)');
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
    expect(track().style.transform).toBe('translateX(-1080px)');
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
    // The sixth card is focused: with five visible the strip has moved by one card (216 px).
    expect(screen.getByTestId('row-track').style.transform).toBe('translateX(-216px)');
  });
});
