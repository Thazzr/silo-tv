// The audio codec badge ("EAC3", "DD+ Atmos", "TrueHD", ...), as Silo's web client words it. The
// player's Audio menu and the detail page's quality badges share this one rule.

/** The track fields that can name a codec and Atmos. */
export interface AudioTrackFormat {
  codec?: string;
  profile?: string;
  title?: string;
  embedded_title?: string;
}

// Codec families that cannot carry Atmos: a compatibility track of one of them is often titled
// after its source ("AC3 5.1 (from TrueHD Atmos)"), so its titles prove nothing.
const NON_ATMOS_CODECS = [
  'aac',
  'ac3',
  'ac-3',
  'dts',
  'flac',
  'mp3',
  'opus',
  'vorbis',
  'pcm',
  'alac',
];
const ATMOS_WORD = /\batmos\b/i;

/**
 * The codec badge, as Silo's web player words it. The stored codec of an Atmos track is plain
 * "eac3" or "truehd", so the profile and the titles count as evidence for Atmos, but only for a
 * codec that can carry it. Null when the track names no codec.
 */
export function audioCodecBadge(track: AudioTrackFormat): string | null {
  const codec = track.codec?.trim();
  if (!codec) return null;
  const lower = codec.toLowerCase();
  const eac3 = lower.includes('eac3') || lower.includes('e-ac-3');
  const truehd = lower.includes('truehd');
  const evidence = [track.profile, track.title, track.embedded_title].filter(Boolean).join(' ');
  const carries = eac3 || !NON_ATMOS_CODECS.some((family) => lower.includes(family));
  if (lower.includes('atmos') || (ATMOS_WORD.test(evidence) && carries)) {
    return truehd ? 'TrueHD Atmos' : eac3 ? 'DD+ Atmos' : 'Atmos';
  }
  if (truehd) return 'TrueHD';
  if (lower.includes('dts-hd') || lower.includes('dts:x')) return 'DTS-HD';
  if (lower.includes('dts')) return 'DTS';
  if (eac3) return 'EAC3';
  if (lower.includes('aac')) return 'AAC';
  if (lower.includes('flac')) return 'FLAC';
  return codec.toUpperCase();
}
