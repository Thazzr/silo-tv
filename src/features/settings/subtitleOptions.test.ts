import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { DEFAULT_SUBTITLE_APPEARANCE } from './profileSettings';
import { summarizeAppearance } from './subtitleOptions';

const t = (...args: Parameters<typeof translate> extends [unknown, ...infer R] ? R : never) =>
  translate('en', ...args);

describe('summarizeAppearance', () => {
  it('names the size, the font colour and the background style, in that order', () => {
    expect(
      summarizeAppearance(
        {
          ...DEFAULT_SUBTITLE_APPEARANCE,
          fontSize: 'xxlarge',
          fontColor: '#ffff00',
          backgroundStyle: 'outline',
          // Fields the summary must not pick up.
          backgroundColor: '#ff0000',
          textOutlineColor: '#0000ff',
          position: 'top',
        },
        t,
      ),
    ).toBe('Huge · Yellow · Outline');
  });

  it('shows a colour outside the palette as its hex value', () => {
    expect(summarizeAppearance({ ...DEFAULT_SUBTITLE_APPEARANCE, fontColor: '#123456' }, t)).toBe(
      'Large · #123456 · Box',
    );
  });
});
