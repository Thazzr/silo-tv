import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { DEFAULT_SUBTITLE_APPEARANCE } from './profileSettings';
import {
  BACKGROUND_OPACITY_RANGE,
  TEXT_OPACITY_RANGE,
  stepOpacity,
  stepValue,
  summarizeAppearance,
} from './subtitleOptions';

const t = (...args: Parameters<typeof translate> extends [unknown, ...infer R] ? R : never) =>
  translate('en', ...args);

describe('summarizeAppearance', () => {
  it('names the size, the font colour and the background style, in that order', () => {
    expect(
      summarizeAppearance(
        {
          ...DEFAULT_SUBTITLE_APPEARANCE,
          fontSize: 'xxlarge',
          fontColor: '#facc15',
          backgroundStyle: 'outline',
          // Fields the summary must not pick up.
          backgroundColor: '#ff0000',
          textOutlineColor: '#0000ff',
          position: 'top',
        },
        t,
      ),
    ).toBe('XX-Large · Yellow · Outline');
  });

  it('shows a colour outside the palette as its hex value', () => {
    expect(summarizeAppearance({ ...DEFAULT_SUBTITLE_APPEARANCE, fontColor: '#123456' }, t)).toBe(
      'Large · #123456 · Box',
    );
  });
});

describe('stepValue', () => {
  const values = ['a', 'b', 'c'];

  it('moves one stop and holds at both ends', () => {
    expect(stepValue(values, 'b', 1)).toBe('c');
    expect(stepValue(values, 'b', -1)).toBe('a');
    expect(stepValue(values, 'c', 1)).toBe('c');
    expect(stepValue(values, 'a', -1)).toBe('a');
  });

  it('takes the first stop on a step forward and the last on a step back from an unknown value', () => {
    expect(stepValue(values, 'x', 1)).toBe('a');
    expect(stepValue(values, 'x', -1)).toBe('c');
  });
});

describe('stepOpacity', () => {
  it('steps by 5 inside the range', () => {
    expect(stepOpacity(75, 1, TEXT_OPACITY_RANGE)).toBe(80);
    expect(stepOpacity(75, -1, TEXT_OPACITY_RANGE)).toBe(70);
  });

  it('holds at the top and at the bottom of the text range (1 to 100)', () => {
    expect(stepOpacity(100, 1, TEXT_OPACITY_RANGE)).toBe(100);
    expect(stepOpacity(5, -1, TEXT_OPACITY_RANGE)).toBe(1);
    expect(stepOpacity(1, -1, TEXT_OPACITY_RANGE)).toBe(1);
    expect(stepOpacity(1, 1, TEXT_OPACITY_RANGE)).toBe(5);
  });

  it('holds at the top and at the bottom of the background range (0 to 100)', () => {
    expect(stepOpacity(0, -1, BACKGROUND_OPACITY_RANGE)).toBe(0);
    expect(stepOpacity(0, 1, BACKGROUND_OPACITY_RANGE)).toBe(5);
    expect(stepOpacity(5, -1, BACKGROUND_OPACITY_RANGE)).toBe(0);
    expect(stepOpacity(100, 1, BACKGROUND_OPACITY_RANGE)).toBe(100);
  });

  it('lands on a multiple of 5 from a value stored by another client', () => {
    expect(stepOpacity(73, 1, TEXT_OPACITY_RANGE)).toBe(75);
    expect(stepOpacity(73, -1, TEXT_OPACITY_RANGE)).toBe(70);
    expect(stepOpacity(98, 1, TEXT_OPACITY_RANGE)).toBe(100);
  });
});
