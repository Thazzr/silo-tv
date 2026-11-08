// Pure capability probing for the TV probe screen. No UI here.

export interface Candidate {
  id: string;
  label: string;
  mime: string;
}

export interface ProbeRow extends Candidate {
  canPlayType: '' | 'maybe' | 'probably';
  /** null when MediaSource is not available at all. */
  mse: boolean | null;
}

export interface ProbeEnv {
  canPlayType(mime: string): string;
  /** Undefined when the platform has no MediaSource. */
  isTypeSupported?: (mime: string) => boolean;
}

function mp4(id: string, label: string, codec: string): Candidate {
  return { id, label, mime: `video/mp4; codecs="${codec}"` };
}
function audio(id: string, label: string, container: 'mp4' | 'webm', codec: string): Candidate {
  return { id, label, mime: `audio/${container}; codecs="${codec}"` };
}

export const CANDIDATES: readonly Candidate[] = [
  { id: 'mp4', label: 'MP4', mime: 'video/mp4' },
  { id: 'webm', label: 'WebM', mime: 'video/webm' },
  { id: 'mkv', label: 'Matroska', mime: 'video/x-matroska' },
  { id: 'mpegts', label: 'MPEG-TS', mime: 'video/mp2t' },
  { id: 'hls-apple', label: 'HLS (vnd.apple)', mime: 'application/vnd.apple.mpegurl' },
  { id: 'hls-x', label: 'HLS (x-mpegURL)', mime: 'application/x-mpegURL' },

  mp4('h264-baseline-30', 'H.264 Baseline 3.0', 'avc1.42E01E'),
  mp4('h264-main-31', 'H.264 Main 3.1', 'avc1.4D401F'),
  mp4('h264-high-40', 'H.264 High 4.0', 'avc1.640028'),
  mp4('h264-high-51', 'H.264 High 5.1', 'avc1.640033'),
  mp4('h264-high-52', 'H.264 High 5.2', 'avc1.640034'),

  mp4('hevc-main-40', 'HEVC Main 4.0 (hvc1)', 'hvc1.1.6.L120.B0'),
  mp4('hevc-main-51', 'HEVC Main 5.1 (hvc1)', 'hvc1.1.6.L153.B0'),
  mp4('hevc-main10-51', 'HEVC Main10 5.1 (hvc1)', 'hvc1.2.4.L153.B0'),
  mp4('hevc-main10-51-hev1', 'HEVC Main10 5.1 (hev1)', 'hev1.2.4.L153.B0'),
  mp4('hevc-main10-52', 'HEVC Main10 5.2 (hvc1)', 'hvc1.2.4.L156.B0'),
  mp4('hevc-main10-61', 'HEVC Main10 6.1 (hvc1)', 'hvc1.2.4.L183.B0'),

  { id: 'vp9-webm', label: 'VP9 Profile 0 (WebM)', mime: 'video/webm; codecs="vp09.00.40.08"' },
  mp4('vp9-mp4-p2', 'VP9 Profile 2 10-bit (MP4)', 'vp09.02.51.10'),

  mp4('av1-main-08', 'AV1 Main 4.0 8-bit', 'av01.0.08M.08'),
  mp4('av1-main-10-51', 'AV1 Main 5.1 10-bit', 'av01.0.13M.10'),
  mp4('av1-main-10-60', 'AV1 Main 6.0 10-bit', 'av01.0.16M.10'),

  mp4('dv-dvh1-05', 'Dolby Vision 5 (dvh1)', 'dvh1.05.06'),
  mp4('dv-dvhe-05', 'Dolby Vision 5 (dvhe)', 'dvhe.05.06'),
  mp4('dv-dvh1-08', 'Dolby Vision 8 (dvh1)', 'dvh1.08.06'),
  mp4('dv-dvhe-08', 'Dolby Vision 8 (dvhe)', 'dvhe.08.06'),
  mp4('dv-dav1-10', 'Dolby Vision 10 (AV1)', 'dav1.10.06'),

  audio('aac-lc', 'AAC-LC', 'mp4', 'mp4a.40.2'),
  audio('he-aac', 'HE-AAC', 'mp4', 'mp4a.40.5'),
  audio('ac3', 'AC-3', 'mp4', 'ac-3'),
  audio('eac3', 'E-AC-3', 'mp4', 'ec-3'),
  audio('opus-mp4', 'Opus (MP4)', 'mp4', 'opus'),
  audio('opus-webm', 'Opus (WebM)', 'webm', 'opus'),
  audio('flac', 'FLAC', 'mp4', 'flac'),
  audio('dts', 'DTS (dtsc)', 'mp4', 'dtsc'),
  audio('dts-express', 'DTS Express (dtse)', 'mp4', 'dtse'),
  audio('truehd', 'TrueHD (mlpa)', 'mp4', 'mlpa'),
  { id: 'mp3', label: 'MP3', mime: 'audio/mpeg' },
  audio('vorbis', 'Vorbis (WebM)', 'webm', 'vorbis'),
];

function defaultEnv(): ProbeEnv {
  const video = document.createElement('video');
  return {
    canPlayType: (mime) => video.canPlayType(mime),
    isTypeSupported:
      typeof MediaSource === 'undefined' ? undefined : (mime) => MediaSource.isTypeSupported(mime),
  };
}

export function probeMedia(env: ProbeEnv = defaultEnv()): ProbeRow[] {
  return CANDIDATES.map((candidate) => {
    const answer = env.canPlayType(candidate.mime);
    return {
      ...candidate,
      canPlayType: answer === 'maybe' || answer === 'probably' ? answer : '',
      mse: env.isTypeSupported ? env.isTypeSupported(candidate.mime) : null,
    };
  });
}

export interface DisplayInfo {
  dynamicRangeHigh: boolean;
  videoDynamicRangeHigh: boolean;
  colorDepth: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export function probeDisplay(): DisplayInfo {
  const matches = (query: string) =>
    typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return {
    dynamicRangeHigh: matches('(dynamic-range: high)'),
    videoDynamicRangeHigh: matches('(video-dynamic-range: high)'),
    colorDepth: screen.colorDepth,
    width: screen.width,
    height: screen.height,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export type DecodingResult =
  { supported: boolean; smooth: boolean; powerEfficient: boolean } | { error: string };

const DECODING_CONFIGS = [
  {
    id: 'h264-1080p30',
    contentType: 'video/mp4; codecs="avc1.640028"',
    width: 1920,
    height: 1080,
    framerate: 30,
    bitrate: 8_000_000,
  },
  {
    id: 'hevc-main10-2160p60',
    contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
    width: 3840,
    height: 2160,
    framerate: 60,
    bitrate: 40_000_000,
  },
  {
    id: 'av1-2160p60',
    contentType: 'video/mp4; codecs="av01.0.13M.10"',
    width: 3840,
    height: 2160,
    framerate: 60,
    bitrate: 40_000_000,
  },
];

/** Optional data: null when navigator.mediaCapabilities is missing; errors are kept per entry. */
export async function probeDecodingInfo(): Promise<Record<string, DecodingResult> | null> {
  const capabilities = navigator.mediaCapabilities as MediaCapabilities | undefined;
  if (!capabilities || typeof capabilities.decodingInfo !== 'function') return null;
  const result: Record<string, DecodingResult> = {};
  for (const { id, ...video } of DECODING_CONFIGS) {
    try {
      const info = await capabilities.decodingInfo({ type: 'media-source', video });
      result[id] = {
        supported: info.supported,
        smooth: info.smooth,
        powerEfficient: info.powerEfficient,
      };
    } catch (error) {
      result[id] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}
