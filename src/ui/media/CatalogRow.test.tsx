import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setFocus } from '../../app/nav';
import { catalogItem } from '../../test/flowFixtures';
import { pressPlayKey } from '../../test/playKey';
import { renderWithSilo } from '../../test/renderFlow';
import { CatalogRow } from './CatalogRow';
import type { CardShape } from './layout';
import { cardFocusKey } from './Row';

function renderRow(shape: CardShape) {
  const items = [
    catalogItem({ content_id: 'a1', title: 'First', type: 'episode', series_title: 'First' }),
    catalogItem({ content_id: 'a2', title: 'Second', type: 'episode', series_title: 'Second' }),
  ];
  const onOpen = vi.fn();
  const onPlay = vi.fn();
  renderWithSilo(
    <CatalogRow
      rowId="row"
      title="Row"
      shape={shape}
      items={items}
      hasMore={false}
      mounted
      prefetchRow={false}
      rowIndex={0}
      onOpen={onOpen}
      onPlay={onPlay}
      onExploreAll={vi.fn()}
      onRowFocused={vi.fn()}
    />,
  );
  return { items, onOpen, onPlay };
}

describe('CatalogRow: the Play key', () => {
  it.each(['landscape', 'poster'] as const)(
    'hands the focused card of a %s row to the play handler, and opens nothing',
    async (shape) => {
      const { items, onOpen, onPlay } = renderRow(shape);
      await screen.findByTestId('row-row');
      await act(async () => {
        await setFocus(cardFocusKey('row', 'a2'));
      });
      await pressPlayKey();
      expect(onPlay).toHaveBeenCalledExactlyOnceWith(items[1]);
      expect(onOpen).not.toHaveBeenCalled();
    },
  );
});
