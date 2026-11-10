import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_APPEARANCE,
  type SubtitleAppearance,
} from '../../features/settings/profileSettings';
import { FONT_SIZES_PX, LIFT, rgba, subtitleStyles } from './appearance';

const look = (over: Partial<SubtitleAppearance> = {}): SubtitleAppearance => ({
  ...DEFAULT_SUBTITLE_APPEARANCE,
  ...over,
});

describe('LIFT', () => {
  it('lifts the bottom positions by 46 vh, above the controls band of 45 vh', () => {
    expect(LIFT).toBe('translateY(-46vh)');
  });
});

describe('subtitleStyles', () => {
  it('maps every font size to its pixel size', () => {
    expect(FONT_SIZES_PX).toEqual({ small: 36, medium: 44, large: 52, xlarge: 62, xxlarge: 72 });
    for (const size of Object.keys(FONT_SIZES_PX) as SubtitleAppearance['fontSize'][]) {
      expect(subtitleStyles(look({ fontSize: size }), false).line.fontSize).toBe(
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
      false,
    );
    expect(line.color).toBe('rgba(0, 255, 0, 0.4)');
    expect(line.backgroundColor).toBe('rgba(0, 0, 255, 0.25)');
    expect(subtitleStyles(look({ backgroundOpacity: 0 }), false).line.backgroundColor).toBe(
      'rgba(0, 0, 0, 0)',
    );
  });

  it('puts the font family first, with a generic fallback', () => {
    expect(subtitleStyles(look({ fontFamily: 'Roboto' }), false).line.fontFamily).toBe(
      'Roboto, sans-serif',
    );
  });

  it('box: a padded background behind the line and no shadow', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'box' }), false);
    expect(line.backgroundColor).toBe('rgba(0, 0, 0, 0.75)');
    expect(line.textShadow).toBe('none');
  });

  it('shadow: a soft static text shadow in the background colour, no box', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'shadow' }), false);
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('0 3px 8px rgba(0, 0, 0, 0.75), 0 0 4px rgba(0, 0, 0, 0.75)');
  });

  it('outline: eight hard offsets around the glyph, no box', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'outline' }), false);
    expect(line.backgroundColor).toBe('transparent');
    expect(String(line.textShadow).match(/ 0 rgba/g)).toHaveLength(8);
    expect(line.textShadow).toContain('-2px -2px 0 rgba(0, 0, 0, 0.75)');
  });

  it('none: neither a box nor a shadow', () => {
    const { line } = subtitleStyles(look({ backgroundStyle: 'none' }), false);
    expect(line.backgroundColor).toBe('transparent');
    expect(line.textShadow).toBe('none');
  });

  it('adds the text outline in its own colour on top of any style', () => {
    const plain = subtitleStyles(look({ backgroundStyle: 'none', textOutline: true }), false);
    expect(plain.line.textShadow).toContain('2px 0px 0 #000000');
    const both = subtitleStyles(
      look({ backgroundStyle: 'shadow', textOutline: true, textOutlineColor: '#ff0000' }),
      false,
    );
    expect(String(both.line.textShadow).match(/ 0 #ff0000/g)).toHaveLength(8);
    expect(String(both.line.textShadow)).toContain('0 3px 8px rgba');
    expect(both.line.textShadow).toContain('2px 2px 0 #ff0000');
    expect(subtitleStyles(look({ textOutline: false }), false).line.textShadow).not.toContain('#');
  });

  it('positions bottom above the safe area, lower-third higher, top below the safe area', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), false).block).toEqual({
      bottom: 'var(--safe-y)',
    });
    expect(subtitleStyles(look({ position: 'lower-third' }), false).block).toEqual({
      bottom: '22vh',
    });
    expect(subtitleStyles(look({ position: 'top' }), false).block).toEqual({
      top: 'var(--safe-y)',
    });
  });

  it('lifts the bottom positions, and only them, while the controls are open', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), true).block.transform).toBe(LIFT);
    expect(subtitleStyles(look({ position: 'lower-third' }), true).block.transform).toBe(LIFT);
    expect(subtitleStyles(look({ position: 'top' }), true).block.transform).toBeUndefined();
    expect(subtitleStyles(look({ position: 'bottom' }), false).block.transform).toBeUndefined();
  });
});

describe('subtitleStyles in a frame', () => {
  const half = { width: 960, height: 540 };
  const full = { width: 1920, height: 1080 };

  it('scales the font size with the frame height', () => {
    expect(subtitleStyles(look({ fontSize: 'large' }), false, half).line.fontSize).toBe('26px');
    expect(subtitleStyles(look({ fontSize: 'xxlarge' }), false, half).line.fontSize).toBe('36px');
    expect(subtitleStyles(look({ fontSize: 'large' }), false, full).line.fontSize).toBe('52px');
  });

  it('scales the outline offsets and the shadow with the frame height', () => {
    const outline = subtitleStyles(look({ backgroundStyle: 'outline' }), false, half).line;
    expect(outline.textShadow).toContain('-1px -1px 0 rgba(0, 0, 0, 0.75)');
    expect(outline.textShadow).not.toContain('2px');
    const ring = subtitleStyles(
      look({ backgroundStyle: 'none', textOutline: true, textOutlineColor: '#ff0000' }),
      false,
      half,
    ).line;
    expect(ring.textShadow).toContain('1px 1px 0 #ff0000');
    const shadow = subtitleStyles(look({ backgroundStyle: 'shadow' }), false, half).line;
    expect(shadow.textShadow).toBe('0 1.5px 4px rgba(0, 0, 0, 0.75), 0 0 2px rgba(0, 0, 0, 0.75)');
  });

  it('scales the padding of the line, which the stylesheet sets on screen', () => {
    expect(subtitleStyles(look(), false, half).line.padding).toBe('1px 7px');
    expect(subtitleStyles(look(), false).line.padding).toBeUndefined();
  });

  it('positions the block in pixels of the frame, not in vh or the safe area', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), false, half).block).toEqual({
      bottom: '27px',
    });
    expect(subtitleStyles(look({ position: 'lower-third' }), false, half).block).toEqual({
      bottom: '118.8px',
    });
    expect(subtitleStyles(look({ position: 'top' }), false, half).block).toEqual({ top: '27px' });
    expect(subtitleStyles(look({ position: 'bottom' }), false, full).block).toEqual({
      bottom: '54px',
    });
  });

  it('lifts in pixels of the frame', () => {
    expect(subtitleStyles(look({ position: 'bottom' }), true, half).block.transform).toBe(
      'translateY(-248.4px)',
    );
  });

  it('rounds the scaled lengths of a frame that does not divide evenly', () => {
    // 720 / 1080 = 2/3 and 810 / 1080 = 3/4: no float noise in the pixel values.
    const third = { width: 1280, height: 720 };
    expect(subtitleStyles(look({ fontSize: 'large' }), false, third).line.fontSize).toBe('34.67px');
    expect(subtitleStyles(look({ fontSize: 'small' }), false, third).line.fontSize).toBe('24px');
    expect(
      subtitleStyles(look({ backgroundStyle: 'outline' }), false, third).line.textShadow,
    ).toContain('-1.33px 0px 0 rgba(0, 0, 0, 0.75)');
    expect(subtitleStyles(look({ position: 'lower-third' }), false, third).block).toEqual({
      bottom: '158.4px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), false, third).block).toEqual({
      bottom: '36px',
    });
    const quarter = { width: 1440, height: 810 };
    expect(subtitleStyles(look({ fontSize: 'large' }), false, quarter).line.fontSize).toBe('39px');
    expect(subtitleStyles(look({ position: 'lower-third' }), false, quarter).block).toEqual({
      bottom: '178.2px',
    });
    expect(subtitleStyles(look({ position: 'bottom' }), true, quarter).block.transform).toBe(
      'translateY(-372.6px)',
    );
  });

  it('gives exactly the screen output without a frame', () => {
    expect(subtitleStyles(look({ backgroundStyle: 'outline', textOutline: true }), true)).toEqual({
      block: { bottom: 'var(--safe-y)', transform: LIFT },
      line: {
        fontFamily: 'sans-serif, sans-serif',
        fontSize: '52px',
        color: 'rgba(255, 255, 255, 1)',
        textShadow:
          '-2px 0px 0 rgba(0, 0, 0, 0.75), 2px 0px 0 rgba(0, 0, 0, 0.75), 0px -2px 0 rgba(0, 0, 0, 0.75), 0px 2px 0 rgba(0, 0, 0, 0.75), -2px -2px 0 rgba(0, 0, 0, 0.75), 2px -2px 0 rgba(0, 0, 0, 0.75), -2px 2px 0 rgba(0, 0, 0, 0.75), 2px 2px 0 rgba(0, 0, 0, 0.75), -2px 0px 0 #000000, 2px 0px 0 #000000, 0px -2px 0 #000000, 0px 2px 0 #000000, -2px -2px 0 #000000, 2px -2px 0 #000000, -2px 2px 0 #000000, 2px 2px 0 #000000',
        backgroundColor: 'transparent',
      },
    });
    expect(subtitleStyles(look({ backgroundStyle: 'shadow' }), false).line.textShadow).toBe(
      '0 3px 8px rgba(0, 0, 0, 0.75), 0 0 4px rgba(0, 0, 0, 0.75)',
    );
  });
});
