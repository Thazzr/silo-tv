import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATES, probeDecodingInfo, probeDisplay, probeMedia } from './mediaProbe';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('probeMedia', () => {
  it('reflects canPlayType and isTypeSupported per candidate', () => {
    const rows = probeMedia({
      canPlayType: (mime) =>
        mime.includes('hvc1.2.4.L153') ? 'probably' : mime === 'video/mp4' ? 'maybe' : '',
      isTypeSupported: (mime) => mime.includes('avc1.640028'),
    });
    expect(rows).toHaveLength(CANDIDATES.length);
    expect(rows.find((r) => r.id === 'mp4')).toMatchObject({ canPlayType: 'maybe', mse: false });
    expect(rows.find((r) => r.id === 'hevc-main10-51')).toMatchObject({
      mime: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
      canPlayType: 'probably',
      mse: false,
    });
    expect(rows.find((r) => r.id === 'h264-high-40')).toMatchObject({ canPlayType: '', mse: true });
  });

  it('normalizes unexpected canPlayType answers to an empty string', () => {
    const rows = probeMedia({ canPlayType: () => 'no way' });
    expect(rows.every((r) => r.canPlayType === '')).toBe(true);
  });

  it('reports mse null without MediaSource', () => {
    const rows = probeMedia({ canPlayType: () => 'maybe' });
    expect(rows.every((r) => r.mse === null)).toBe(true);
  });

  it('uses the browser environment by default', () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    expect(probeMedia()[0]).toMatchObject({ canPlayType: 'probably', mse: true });
  });
});

describe('probeDisplay', () => {
  it('reads dynamic range media queries and the screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(dynamic-range: high)',
    }));
    expect(probeDisplay()).toEqual({
      dynamicRangeHigh: true,
      videoDynamicRangeHigh: false,
      colorDepth: screen.colorDepth,
      width: screen.width,
      height: screen.height,
      devicePixelRatio: window.devicePixelRatio,
    });
  });
});

describe('probeDecodingInfo', () => {
  it('returns null without mediaCapabilities', async () => {
    vi.stubGlobal('navigator', {});
    await expect(probeDecodingInfo()).resolves.toBeNull();
  });

  it('captures an error per entry without losing the others', async () => {
    const decodingInfo = vi.fn(async (config: { video: { contentType: string } }) => {
      if (config.video.contentType.includes('hvc1')) throw new Error('unsupported config');
      return { supported: true, smooth: false, powerEfficient: true };
    });
    vi.stubGlobal('navigator', { mediaCapabilities: { decodingInfo } });
    const result = await probeDecodingInfo();
    const ok = { supported: true, smooth: false, powerEfficient: true };
    expect(result).toEqual({
      'h264-1080p30': ok,
      'hevc-main10-2160p60': { error: 'unsupported config' },
      'av1-2160p60': ok,
    });
    expect(decodingInfo.mock.calls[0]?.[0]).toMatchObject({ type: 'media-source' });
  });
});
