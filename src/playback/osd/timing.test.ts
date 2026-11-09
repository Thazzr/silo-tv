import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import { bufferedUntil, clampTime, headingLines, stepRate } from './timing';

describe('stepRate', () => {
  it('starts at 2x and steps up to 16x, where it stays', () => {
    const rates = [stepRate(0, 1)];
    for (let i = 0; i < 4; i += 1) rates.push(stepRate(rates.at(-1)!, 1));
    expect(rates).toEqual([2, 4, 8, 16, 16]);
  });

  it('goes the other way from standstill', () => {
    expect(stepRate(0, -1)).toBe(-2);
    expect(stepRate(-2, -1)).toBe(-4);
  });

  it('slows down on the opposite direction and then reverses', () => {
    const rates = [16];
    for (let i = 0; i < 5; i += 1) rates.push(stepRate(rates.at(-1)!, -1));
    expect(rates).toEqual([16, 8, 4, 2, -2, -4]);
    expect(stepRate(-8, 1)).toBe(-4);
    expect(stepRate(-2, 1)).toBe(2);
  });
});

describe('clampTime', () => {
  it('keeps a time between zero and the duration', () => {
    expect(clampTime(-5, 100)).toBe(0);
    expect(clampTime(50, 100)).toBe(50);
    expect(clampTime(150, 100)).toBe(100);
  });

  it('has no upper bound while the duration is unknown', () => {
    expect(clampTime(9999, 0)).toBe(9999);
  });
});

describe('bufferedUntil', () => {
  it('maps the end of the range around the playhead onto the source timeline', () => {
    // The engine is at 10 s of its own timeline, which is 610 s of the source.
    expect(bufferedUntil([{ start: 0, end: 40 }], 10, 610)).toBe(640);
  });

  it('ignores ranges that do not hold the playhead', () => {
    expect(bufferedUntil([{ start: 100, end: 140 }], 10, 610)).toBe(610);
    expect(bufferedUntil([], 10, 610)).toBe(610);
  });
});

describe('headingLines', () => {
  it('shows the series above an episode and numbers before its title', () => {
    expect(
      headingLines({ title: 'Pilot', seriesTitle: 'Show', seasonNumber: 1, episodeNumber: 2 }, 'x'),
    ).toEqual({ series: 'Show', title: 'S1 · E2 · Pilot' });
  });

  it('shows a movie by its title alone, and falls back before the title is known', () => {
    expect(headingLines({ title: 'Film' }, 'x')).toEqual({ series: null, title: 'Film' });
    expect(headingLines(null, 'Given')).toEqual({ series: null, title: 'Given' });
  });
});

describe('overlay texts', () => {
  const keys: MessageKey[] = [
    'player.osd.skipBack',
    'player.osd.skipForward',
    'player.osd.play',
    'player.osd.pause',
    'player.osd.close',
    'player.osd.position',
    'player.osd.scrubbing',
  ];

  it.each(keys)('%s exists in German and English and is not left as the key', (key) => {
    for (const lang of ['de', 'en'] as const) {
      const text = translate(lang, key, { seconds: 10, rate: '4×' });
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('names the skip amount in both languages', () => {
    expect(translate('de', 'player.osd.skipBack', { seconds: 10 })).toBe('10 Sekunden zurück');
    expect(translate('en', 'player.osd.skipForward', { seconds: 30 })).toBe('30 seconds forward');
  });
});
