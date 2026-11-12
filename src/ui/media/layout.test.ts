import { describe, expect, it } from 'vitest';
import {
  CAPTION_HEIGHT,
  CARD_SIZE,
  captionOffset,
  cardBlockHeight,
  rowHeight,
  rowStep,
  rowVisibleCards,
  type CardMetrics,
} from './layout';

describe('row metrics', () => {
  const landscape: CardMetrics = {
    ...CARD_SIZE.landscape,
    captionOffset: captionOffset('landscape'),
    captionHeight: CAPTION_HEIGHT,
  };

  it('give the numbers of the shape they restate', () => {
    expect(rowStep(landscape)).toBe(rowStep('landscape'));
    expect(rowVisibleCards(landscape)).toBe(rowVisibleCards('landscape'));
    expect(cardBlockHeight(landscape)).toBe(cardBlockHeight('landscape'));
    expect(rowHeight(landscape)).toBe(rowHeight('landscape'));
  });

  it('give a person a caption of two 26 px lines, unlike the 57 px of the other shapes', () => {
    expect(cardBlockHeight('person')).toBe(128 + 8 + 52);
    expect(rowHeight('person')).toBe(48 + 28 + (128 + 8 + 52) + 10);
    expect(cardBlockHeight('poster')).toBe(264 + 22 + 57);
  });

  it('size a row of other cards by their own width, art height and caption', () => {
    const cards: CardMetrics = { width: 330, height: 186, captionOffset: 14, captionHeight: 135 };
    expect(rowStep(cards)).toBe(370);
    expect(rowVisibleCards(cards)).toBe(4);
    expect(cardBlockHeight(cards)).toBe(186 + 14 + 135);
    expect(rowHeight(cards)).toBe(
      rowHeight('landscape') + (186 + 14 + 135) - cardBlockHeight('landscape'),
    );
  });
});
