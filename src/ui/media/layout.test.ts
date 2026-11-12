import { describe, expect, it } from 'vitest';
import {
  CAPTION_HEIGHT,
  CARD_GAP,
  CARD_SIZE,
  captionOffset,
  cardBlockHeight,
  rowHeight,
  rowStep,
  rowVisibleCards,
  WIDE_CAPTION_HEIGHT,
  type CardMetrics,
} from './layout';

describe('the card shapes of a row', () => {
  it("are the web's 185x278 poster and 315x177 wide card, 20 px apart", () => {
    expect(CARD_SIZE.poster).toEqual({ width: 185, height: 278 });
    expect(CARD_SIZE.landscape).toEqual({ width: 315, height: 177 });
    expect(rowStep('poster')).toBe(205);
    expect(rowStep('landscape')).toBe(335);
    // A person's column keeps its wider gap.
    expect(rowStep('person')).toBe(150 + CARD_GAP);
  });

  it('fit 8 posters or 5 wide cards between the 80 px insets', () => {
    expect(rowVisibleCards('poster')).toBe(8);
    expect(rowVisibleCards('landscape')).toBe(5);
  });

  it('give a wide card three caption lines and a poster two', () => {
    expect(WIDE_CAPTION_HEIGHT).toBe(31 + 26 + 26);
    expect(cardBlockHeight('landscape')).toBe(177 + 14 + WIDE_CAPTION_HEIGHT);
    expect(cardBlockHeight('poster')).toBe(278 + 22 + CAPTION_HEIGHT);
  });
});

describe('row metrics', () => {
  const landscape: CardMetrics = {
    ...CARD_SIZE.landscape,
    captionOffset: captionOffset('landscape'),
    captionHeight: WIDE_CAPTION_HEIGHT,
    gap: 20,
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
    expect(cardBlockHeight('poster')).toBe(278 + 22 + 57);
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
