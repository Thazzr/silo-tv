import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import { bufferedUntil, clampTime, stepRate, titleBlock } from './timing';

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

describe('titleBlock', () => {
  it('shows the series as the title and the numbers and episode title in capitals below it', () => {
    expect(
      titleBlock(
        { title: 'Pilot', seriesTitle: 'Show', seasonNumber: 1, episodeNumber: 2 },
        'x',
        2020,
      ),
    ).toEqual({ title: 'Show', detail: 'S1 · E2 — PILOT' });
  });

  it('leaves out the numbers an episode does not have', () => {
    expect(titleBlock({ title: 'Pilot', seriesTitle: 'Show' }, 'x', undefined)).toEqual({
      title: 'Show',
      detail: 'PILOT',
    });
  });

  it('shows a movie by its title and its year, and falls back before the title is known', () => {
    expect(titleBlock({ title: 'Film' }, 'x', 1999)).toEqual({ title: 'Film', detail: '1999' });
    expect(titleBlock({ title: 'Film' }, 'x', undefined)).toEqual({ title: 'Film', detail: '' });
    expect(titleBlock(null, 'Given', 2001)).toEqual({ title: 'Given', detail: '2001' });
  });
});

describe('overlay texts', () => {
  const keys: MessageKey[] = [
    'player.osd.skipBack',
    'player.osd.skipForward',
    'player.osd.play',
    'player.osd.pause',
    'player.osd.exit',
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
