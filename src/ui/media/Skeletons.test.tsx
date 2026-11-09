import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithSilo } from '../../test/renderFlow';
import { rowHeight, rowVisibleCards } from './layout';
import { CardSkeleton, GridSkeleton, RowSkeleton } from './Skeletons';

describe('skeletons', () => {
  it('a card skeleton has the shape and the caption lines of the card it replaces', () => {
    renderWithSilo(<CardSkeleton shape="landscape" />);
    const card = screen.getByTestId('card-skeleton');
    expect(card).toHaveClass('card-landscape');
    expect(card.querySelector('.card-art')).not.toBeNull();
    expect(card.querySelectorAll('.skeleton-line')).toHaveLength(2);
  });

  it('a row skeleton is as high as a real row of its shape and fills the screen with cards', () => {
    renderWithSilo(
      <>
        <RowSkeleton shape="poster" />
        <RowSkeleton shape="landscape" />
      </>,
    );
    const [poster, landscape] = screen.getAllByTestId('row-skeleton');
    expect(poster!.style.height).toBe(`${rowHeight('poster')}px`);
    expect(landscape!.style.height).toBe(`${rowHeight('landscape')}px`);
    expect(poster!.querySelectorAll('[data-testid="card-skeleton"]')).toHaveLength(
      rowVisibleCards('poster') + 1,
    );
    expect(landscape!.querySelectorAll('.card-landscape')).toHaveLength(
      rowVisibleCards('landscape') + 1,
    );
  });

  it('a grid skeleton is two rows of six grid posters with a loading label', () => {
    renderWithSilo(<GridSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading titles …' })).toBeInTheDocument();
    const cards = screen.getAllByTestId('card-skeleton');
    expect(cards).toHaveLength(12);
    expect(cards[0]).toHaveClass('card-grid');
  });
});
