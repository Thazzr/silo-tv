// Probe fixtures for the device profile tests: one TV modelled on the first test TV, one browser.
import type { HdrConfig } from '../platform/device';
import { CANDIDATES, type DisplayInfo, type ProbeRow } from '../platform/mediaProbe';
import type { ProfileProbe } from '../playback/deviceProfile';

type Answer = '' | 'maybe' | 'probably';

function rows(answer: (id: string) => Answer): ProbeRow[] {
  return CANDIDATES.map((candidate) => {
    const canPlayType = answer(candidate.id);
    return { ...candidate, canPlayType, mse: canPlayType === 'probably' };
  });
}

const TV_UNSUPPORTED = new Set(['mkv', 'dv-dav1-10', 'dts-express', 'truehd']);

/** The first test TV: H.264 to High 5.2, HEVC Main10 6.1, VP9, AV1, DV 5/8, no TrueHD, no MKV answer. */
export const tvRows: ProbeRow[] = rows((id) => {
  if (TV_UNSUPPORTED.has(id)) return '';
  if (id === 'mp4' || id === 'webm' || id === 'mpegts' || id.startsWith('hls-')) return 'maybe';
  return 'probably';
});

/** A desktop browser: H.264 to 4.0, VP9 and AV1, no HEVC, no Dolby Vision, no HLS, no Matroska. */
export const browserRows: ProbeRow[] = rows((id) => {
  const yes = new Set([
    'h264-baseline-30',
    'h264-main-31',
    'h264-high-40',
    'vp9-webm',
    'av1-main-08',
    'aac-lc',
    'mp3',
    'opus-webm',
    'flac',
    'vorbis',
  ]);
  if (id === 'mp4' || id === 'webm') return 'maybe';
  return yes.has(id) ? 'probably' : '';
});

export const tvDisplay: DisplayInfo = {
  dynamicRangeHigh: true,
  videoDynamicRangeHigh: true,
  colorDepth: 24,
  width: 1920,
  height: 1080,
  devicePixelRatio: 2,
};

export const hdrFlags: HdrConfig = { known: true, hdr: true, dolbyVision: true, atmos: true };
export const noFlags: HdrConfig = { known: true, hdr: false, dolbyVision: false, atmos: false };

export function tvProbe(overrides: Partial<ProfileProbe> = {}): ProfileProbe {
  return {
    media: tvRows,
    display: tvDisplay,
    hdr: hdrFlags,
    platform: 'webos',
    appVersion: '0.0.1',
    osVersion: '24.0.0',
    ...overrides,
  };
}

export function browserProbe(overrides: Partial<ProfileProbe> = {}): ProfileProbe {
  return {
    media: browserRows,
    display: { ...tvDisplay, devicePixelRatio: 1 },
    hdr: { known: false, hdr: false, dolbyVision: false, atmos: false },
    platform: 'browser',
    appVersion: '0.0.1',
    ...overrides,
  };
}
