/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  type SubtitleAppearance,
} from '../../features/settings/profileSettings';
import { FONT_SIZES_PX, RESTING_GAP, rgba, subtitleStyles } from './appearance';

const look = (over: Partial<SubtitleAppearance> = {}): SubtitleAppearance => ({
  ...DEFAULT_SUBTITLE_APPEARANCE,
  ...over,
});

describe('RESTING_GAP', () => {
  it('is the web player offset, never under the 5 % TV safe area', () => {
    expect(RESTING_GAP).toEqual({ bottom: 0.07, 'lower-third': 0.12, top: 0.07 });
    for (const gap of Object.values(RESTING_GAP)) expect(gap).toBeGreaterThanOrEqual(0.05);
  });

  it('is 75.6 px at the bottom of a 1080p screen, and a frame scales it the same way', () => {
    const frame = { width: 960, height: 540 };
    expect(subtitleStyles(look({ position: 'bottom' }), 0, frame).block.bottom).toBe('37.8px');
    expect(
      subtitleStyles(look({ position: 'bottom' }), 0, { width: 1920, height: 1080 }).block.bottom,
    ).toBe('75.6px');
  });
});

describe('subtitleStyles', () => {
  it('maps every font size to its pixel size', () => {
    // The web player's 20, 26, 32, 40 and 48 px at 720 px, on the 1080p layout.
    expect(FONT_SIZES_PX).toEqual({ small: 30, medium: 39, large: 48, xlarge: 60, xxlarge: 72 });
    for (const size of Object.keys(FONT_SIZES_PX) as SubtitleAppearance['fontSize'][]) {
      expect(subtitleStyles(look({ fontSize: size }), 0).line.fontSize).toBe(
        `${FONT_SIZES_PX[size]}px`,
      );
    }
  });

  it('turns colours and opacities into rgba', () => {
    expect(rgba('#ff8000', 50)).toBe('rgba(255, 128, 0, 0.5)');
    const { line } = subtitleStyles(
      look({
        fontColor: '#00ff00',
        textOpacity: 40,
        backgroundColor: '#0000ff',
        backgroundOpacity: 25,
      }),
      0,
    );
    expect(line.color).toBe('rgba(0, 255, 0, 0.4)');
    expect(line.backgroundColor).toBe('rgba(0, 0, 255, 0.25)');
    expect(subtitleStyles(look({ backgroundOpacity: 0 }), 0).line.backgroundColor).toBe(
      'rgba(0, 0, 0, 0)',
    );
  });

  it('puts the font family first, with a generic fallback', () => {
    expect(subtitleStyles(look({ fontFamily: 'Roboto' }), 0).line.fontFamily).toBe(
      'Roboto, sans-serif',
    );
  });

  const RING = (c: string, o: string, d: string) =>
    [
      `-${o} 0px 0 ${c}`,
      `${o} 0px 0 ${c}`,
      `0px -${o} 0 ${c}`,
      `0px ${o} 0 ${c}`,
      `-${d} -${d} 0 ${c}`,
      `-${d} ${d} 0 ${c}`,
      `${d} -${d} 0 ${c}`,
      `${d} ${d} 0 ${c}`,
    ].join(', ');

  it('box: the background colour at its opacity, padded 12 x 4 and rounded 4, no shadow', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'box' }), 0);
    expect(line.backgroundColor).toBe('rgba(0, 0, 0, 0.75)');
    expect(line.textShadow).toBe('none');
    // The web's fixed 12 x 4 px and 4 px, whatever the screen size.
    expect(line.padding).toBe('4px 12px');
    expect(line.borderRadius).toBe('4px');
  });

  it('shadow: the web drop shadow, always black at 0.9 whatever the background colour, no box', () => {
    const { line } = subtitleStyles(
      look({ backgroundStyle: 'shadow', backgroundColor: '#ff0000', backgroundOpacity: 30 }),
      0,
    );
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('2px 2px 4px rgba(0,0,0,0.9)');
  });

  it('outline: eight hard offsets in the text outline colour, no box', () => {
    const { line } = subtitleStyles(
      look({ backgroundStyle: 'outline', textOutlineColor: '#ff0000', backgroundColor: '#00ff00' }),
      0,
    );
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe(RING('#ff0000', '1px', '2px'));
  });

  it('none: neither a box nor a shadow, but the padding stays as in the web', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'none' }), 0);
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('none');
    expect(line.padding).toBe('4px 12px');
  });

  it('text outline: two stacked 3 px glows in the outline colour on top of any style', () => {
    const glow = '0 0 3px #ff0000, 0 0 3px #ff0000';
    const outlined = { textOutline: true, textOutlineColor: '#ff0000' } as const;
    expect(subtitleStyles(look({ backgroundStyle: 'none', ...outlined }), 0).line.textShadow).toBe(
      glow,
    );
    expect(subtitleStyles(look({ backgroundStyle: 'box', ...outlined }), 0).line.textShadow).toBe(
      glow,
    );
    expect(
      subtitleStyles(look({ backgroundStyle: 'shadow', ...outlined }), 0).line.textShadow,
    ).toBe(`2px 2px 4px rgba(0,0,0,0.9), ${glow}`);
    expect(
      subtitleStyles(look({ backgroundStyle: 'outline', ...outlined }), 0).line.textShadow,
    ).toBe(`${RING('#ff0000', '1px', '2px')}, ${glow}`);
    expect(subtitleStyles(look({ textOutline: false }), 0).line.textShadow).toBe('none');
  });

  it('rests like the web player: bottom 7 %, lower third 12 %, top 7 % of the height', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), 0).block).toEqual({
      bottom: '7vh',
    });
    expect(subtitleStyles(look({ position: 'lower-third' }), 0).block).toEqual({
      bottom: '12vh',
    });
    expect(subtitleStyles(look({ position: 'top' }), 0).block).toEqual({
      top: '7vh',
    });
  });

  it('moves the block up by exactly the given lift, and not at all for 0', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), 312).block.transform).toBe(
      'translateY(-312px)',
    );
    expect(subtitleStyles(look({ position: 'bottom' }), 0).block.transform).toBeUndefined();
  });
});

describe('subtitleStyles in a frame', () => {
  const half = { width: 960, height: 540 };
  const full = { width: 1920, height: 1080 };

  it('scales the font size with the frame height', () => {
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, half).line.fontSize).toBe('24px');
    expect(subtitleStyles(look({ fontSize: 'xxlarge' }), 0, half).line.fontSize).toBe('36px');
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, full).line.fontSize).toBe('48px');
  });

  it('takes the size scale from the frame when it names one, and the offsets from its height', () => {
    const preview = { width: 920, height: 330, scale: 1 };
    const { block, line } = subtitleStyles(look({ fontSize: 'xlarge' }), 0, preview);
    expect(line.fontSize).toBe('60px');
    expect(block.bottom).toBe('23.1px');
  });

  it('scales only the font size with the frame: effects, padding and radius stay fixed, as in the web', () => {
    const red = { textOutlineColor: '#ff0000' };
    const at = (over: Partial<SubtitleAppearance>, frame: { width: number; height: number }) =>
      subtitleStyles(look({ textOutline: true, ...red, ...over }), 0, frame).line;
    for (const style of ['box', 'shadow', 'outline', 'none'] as const) {
      const small = at({ backgroundStyle: style }, half);
      const big = at({ backgroundStyle: style }, full);
      expect(small.fontSize).toBe('24px');
      expect(big.fontSize).toBe('48px');
      expect(small.textShadow).toBe(big.textShadow);
      expect(small.padding).toBe('4px 12px');
      expect(small.borderRadius).toBe('4px');
    }
  });

  it('draws a preview frame with the same fixed effects as the screen', () => {
    const preview = { width: 920, height: 330, scale: 1 };
    const { line } = subtitleStyles(look({ backgroundStyle: 'shadow' }), 0, preview);
    expect(line.textShadow).toBe('2px 2px 4px rgba(0,0,0,0.9)');
    expect(line.padding).toBe('4px 12px');
    expect(line.borderRadius).toBe('4px');
  });

  it('positions the block in pixels of the frame, not in vh', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), 0, half).block).toEqual({
      bottom: '37.8px',
    });
    expect(subtitleStyles(look({ position: 'lower-third' }), 0, half).block).toEqual({
      bottom: '64.8px',
    });
    expect(subtitleStyles(look({ position: 'top' }), 0, half).block).toEqual({ top: '37.8px' });
    expect(subtitleStyles(look({ position: 'bottom' }), 0, full).block).toEqual({
      bottom: '75.6px',
    });
  });

  it('rounds the scaled lengths of a frame that does not divide evenly', () => {
    // 720 / 1080 = 2/3 and 810 / 1080 = 3/4: no float noise in the pixel values.
    const third = { width: 1280, height: 720 };
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, third).line.fontSize).toBe('32px');
    expect(subtitleStyles(look({ fontSize: 'small' }), 0, third).line.fontSize).toBe('20px');
    expect(subtitleStyles(look({ position: 'lower-third' }), 0, third).block).toEqual({
      bottom: '86.4px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), 0, third).block).toEqual({
      bottom: '50.4px',
    });
    const quarter = { width: 1440, height: 810 };
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, quarter).line.fontSize).toBe('36px');
    expect(subtitleStyles(look({ fontSize: 'medium' }), 0, quarter).line.fontSize).toBe('29.25px');
    expect(subtitleStyles(look({ position: 'lower-third' }), 0, quarter).block).toEqual({
      bottom: '97.2px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), 80, quarter).block.transform).toBe(
      'translateY(-80px)',
    );
  });

  it('gives exactly the screen output without a frame', () => {
    expect(subtitleStyles(look({ backgroundStyle: 'shadow', textOutline: true }), 0)).toEqual({
      block: { bottom: '7vh' },
      line: {
        fontFamily: 'sans-serif, sans-serif',
        fontSize: '48px',
        color: 'rgba(255, 255, 255, 1)',
        textShadow: '2px 2px 4px rgba(0,0,0,0.9), 0 0 3px #000000, 0 0 3px #000000',
        backgroundColor: 'transparent',
        padding: '4px 12px',
        borderRadius: '4px',
      },
    });
  });
});

describe('the cue line stylesheet', () => {
  it('has the web line height (snug) and leaves padding and radius to the inline style', () => {
    const css = readFileSync('src/styles.css', 'utf-8');
    const line = /\.player-subtitle-line \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(line).toContain('line-height: 1.375');
    expect(line).not.toContain('padding');
    expect(line).not.toContain('border-radius');
  });
});
