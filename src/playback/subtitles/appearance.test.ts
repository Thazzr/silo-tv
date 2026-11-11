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
    expect(FONT_SIZES_PX).toEqual({ small: 36, medium: 44, large: 52, xlarge: 62, xxlarge: 72 });
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

  it('box: a padded background behind the line and no shadow', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'box' }), 0);
    expect(line.backgroundColor).toBe('rgba(0, 0, 0, 0.75)');
    expect(line.textShadow).toBe('none');
  });

  it('shadow: a soft static text shadow in the background colour, no box', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'shadow' }), 0);
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('0 3px 8px rgba(0, 0, 0, 0.75), 0 0 4px rgba(0, 0, 0, 0.75)');
  });

  it('outline: eight hard offsets around the glyph, no box', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'outline' }), 0);
    expect(line.backgroundColor).toBe('transparent');
    expect(String(line.textShadow).match(/ 0 rgba/g)).toHaveLength(8);
    expect(line.textShadow).toContain('-2px -2px 0 rgba(0, 0, 0, 0.75)');
  });

  it('none: neither a box nor a shadow', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'none' }), 0);
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('none');
  });

  it('adds the text outline in its own colour on top of any style', () => {
    const plain = subtitleStyles(look({ backgroundStyle: 'none', textOutline: true }), 0);
    expect(plain.line.textShadow).toContain('2px 0px 0 #000000');
    const both = subtitleStyles(
      look({ backgroundStyle: 'shadow', textOutline: true, textOutlineColor: '#ff0000' }),
      0,
    );
    expect(String(both.line.textShadow).match(/ 0 #ff0000/g)).toHaveLength(8);
    expect(String(both.line.textShadow)).toContain('0 3px 8px rgba');
    expect(both.line.textShadow).toContain('2px 2px 0 #ff0000');
    expect(subtitleStyles(look({ textOutline: false }), 0).line.textShadow).not.toContain('#');
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
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, half).line.fontSize).toBe('26px');
    expect(subtitleStyles(look({ fontSize: 'xxlarge' }), 0, half).line.fontSize).toBe('36px');
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, full).line.fontSize).toBe('52px');
  });

  it('scales the outline offsets and the shadow with the frame height', () => {
    const outline = subtitleStyles(look({ backgroundStyle: 'outline' }), 0, half).line;
    expect(outline.textShadow).toContain('-1px -1px 0 rgba(0, 0, 0, 0.75)');
    expect(outline.textShadow).not.toContain('2px');
    const ring = subtitleStyles(
      look({ backgroundStyle: 'none', textOutline: true, textOutlineColor: '#ff0000' }),
      0,
      half,
    ).line;
    expect(ring.textShadow).toContain('1px 1px 0 #ff0000');
    const shadow = subtitleStyles(look({ backgroundStyle: 'shadow' }), 0, half).line;
    expect(shadow.textShadow).toBe('0 1.5px 4px rgba(0, 0, 0, 0.75), 0 0 2px rgba(0, 0, 0, 0.75)');
  });

  it('scales the padding of the line, which the stylesheet sets on screen', () => {
    expect(subtitleStyles(look(), 0, half).line.padding).toBe('1px 7px');
    expect(subtitleStyles(look(), 0).line.padding).toBeUndefined();
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
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, third).line.fontSize).toBe('34.67px');
    expect(subtitleStyles(look({ fontSize: 'small' }), 0, third).line.fontSize).toBe('24px');
    expect(
      subtitleStyles(look({ backgroundStyle: 'outline' }), 0, third).line.textShadow,
    ).toContain('-1.33px 0px 0 rgba(0, 0, 0, 0.75)');
    expect(subtitleStyles(look({ position: 'lower-third' }), 0, third).block).toEqual({
      bottom: '86.4px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), 0, third).block).toEqual({
      bottom: '50.4px',
    });
    const quarter = { width: 1440, height: 810 };
    expect(subtitleStyles(look({ fontSize: 'large' }), 0, quarter).line.fontSize).toBe('39px');
    expect(subtitleStyles(look({ position: 'lower-third' }), 0, quarter).block).toEqual({
      bottom: '97.2px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), 80, quarter).block.transform).toBe(
      'translateY(-80px)',
    );
  });

  it('gives exactly the screen output without a frame', () => {
    expect(subtitleStyles(look({ backgroundStyle: 'outline', textOutline: true }), 0)).toEqual({
      block: { bottom: '7vh' },
      line: {
        fontFamily: 'sans-serif, sans-serif',
        fontSize: '52px',
        color: 'rgba(255, 255, 255, 1)',
        textShadow:
          '-2px 0px 0 rgba(0, 0, 0, 0.75), 2px 0px 0 rgba(0, 0, 0, 0.75), 0px -2px 0 rgba(0, 0, 0, 0.75), 0px 2px 0 rgba(0, 0, 0, 0.75), -2px -2px 0 rgba(0, 0, 0, 0.75), 2px -2px 0 rgba(0, 0, 0, 0.75), -2px 2px 0 rgba(0, 0, 0, 0.75), 2px 2px 0 rgba(0, 0, 0, 0.75), -2px 0px 0 #000000, 2px 0px 0 #000000, 0px -2px 0 #000000, 0px 2px 0 #000000, -2px -2px 0 #000000, 2px -2px 0 #000000, -2px 2px 0 #000000, 2px 2px 0 #000000',
        backgroundColor: 'transparent',
      },
    });
    expect(subtitleStyles(look({ backgroundStyle: 'shadow' }), 0).line.textShadow).toBe(
      '0 3px 8px rgba(0, 0, 0, 0.75), 0 0 4px rgba(0, 0, 0, 0.75)',
    );
  });
});
