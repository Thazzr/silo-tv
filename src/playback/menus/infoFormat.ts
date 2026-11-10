// How the Info panel writes codecs, channel layouts and units. Pure functions: the panel passes the
// language's decimal separator ("," in German), nothing here reads the app's language itself.

/** Codec ids as the server reports them (ffmpeg names) and the way people write them. */
const VIDEO_CODECS: Record<string, string> = {
  h264: 'H.264',
  avc: 'H.264',
  avc1: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  hvc1: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vc1: 'VC-1',
};

const AUDIO_CODECS: Record<string, string> = {
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  dca: 'DTS',
  truehd: 'TrueHD',
  mlp: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
  mp2: 'MP2',
  vorbis: 'Vorbis',
  alac: 'ALAC',
};

const key = (codec: string): string =>
  codec
    .trim()
    .toLowerCase()
    .replace(/[-_.\s]/g, '');

/** "H.264", "HEVC", "AV1", "VP9"; a codec this table does not know in capitals. Null when blank. */
export function videoCodecName(codec: string | null | undefined): string | null {
  if (!codec?.trim()) return null;
  return VIDEO_CODECS[key(codec)] ?? codec.trim().toUpperCase();
}

/** "AAC", "AC-3", "E-AC-3", "DTS", "TrueHD", "FLAC", "Opus", "MP3"; unknown ones in capitals. */
export function audioCodecName(codec: string | null | undefined): string | null {
  if (!codec?.trim()) return null;
  const k = key(codec);
  if (k.startsWith('pcm')) return 'PCM';
  // DTS-HD and DTS:X are named by their own profile; the codec id alone says DTS.
  return AUDIO_CODECS[k] ?? codec.trim().toUpperCase();
}

/**
 * "Mono", "Stereo", "5.1", "7.1": from the layout string when it says one ("5.1(side)", "stereo"),
 * else from the channel count. Null when neither is known.
 */
export function channelLayout(channels: number | undefined, layout?: string | null): string | null {
  const text = layout?.trim().toLowerCase();
  if (text) {
    const numeric = /^(\d)\.(\d)/.exec(text);
    if (numeric) return `${numeric[1]}.${numeric[2]}`;
    if (text === 'mono') return 'Mono';
    if (text === 'stereo') return 'Stereo';
  }
  if (!channels || channels <= 0) return null;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels} ch`;
}

/** Whether `word` names an audio codec (`AC3`, `E-AC-3`, `DTS`, `aac`). */
export function isAudioCodecWord(word: string): boolean {
  const k = key(word);
  if (!k) return false;
  if (k.startsWith('pcm') || k.startsWith('dts') || k === 'dd' || k === 'ddp' || k === 'atmos')
    return true;
  return k in AUDIO_CODECS || Object.values(AUDIO_CODECS).some((name) => key(name) === k);
}

/** "High", "Main 10", "Constrained Baseline": a profile name with its words capitalised. */
export function profileName(profile: string | null | undefined): string | null {
  const text = profile?.trim();
  if (!text) return null;
  return text
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** A number with at most `places` decimals, no trailing zeros, in the language's separator. */
function plain(value: number, places: number, decimal: string): string {
  return String(Number(value.toFixed(places))).replace('.', decimal);
}

/** "8.5 Mbit/s" from 1000 kbit/s up, "800 kbit/s" below; null when unknown. */
export function formatBitrate(kbps: number | null | undefined, decimal = '.'): string | null {
  if (kbps === null || kbps === undefined || !(kbps > 0)) return null;
  if (kbps < 1000) return `${Math.round(kbps)} kbit/s`;
  return `${plain(Math.round(kbps / 100) / 10, 1, decimal)} Mbit/s`;
}

/** "850 MB" below a gigabyte, "4.2 GB" above (1024-based, as file managers show it). */
export function formatFileSize(bytes: number | null | undefined, decimal = '.'): string | null {
  if (bytes === null || bytes === undefined || !(bytes > 0)) return null;
  const mb = bytes / 1024 ** 2;
  if (mb < 1024) return `${Math.max(1, Math.round(mb))} MB`;
  return `${plain(mb / 1024, 1, decimal)} GB`;
}

/** "24", "23.976" (up to three decimals); null when unknown. */
export function formatFrameRate(fps: number | null | undefined, decimal = '.'): string | null {
  if (fps === null || fps === undefined || !(fps > 0)) return null;
  return plain(fps, 3, decimal);
}

/** "48 kHz", "44.1 kHz" from a rate in Hz; null when unknown. */
export function formatSampleRate(hz: number | null | undefined, decimal = '.'): string | null {
  if (hz === null || hz === undefined || !(hz > 0)) return null;
  return `${plain(hz / 1000, 1, decimal)} kHz`;
}
