// What the Audio and Subtitles menus list and what a pick sends, as pure functions over the plan and
// the played version's track lists. Nothing here reads or returns a path, a file name or a URL.
import type { Language } from '../../i18n';
import { languageName } from '../../i18n/languages';
import { audioCodecBadge } from '../audioLabel';
import type { MediaFacts, Plan, S, SelectedTracks } from '../session/types';
import { trackIndex } from './info';

type TrackIdentity = NonNullable<SelectedTracks['audio']>;
export type InventoryItem = S['SubtitleInventoryItemV3'];

/** The words the track rows need from the app's translation. */
export interface TrackText {
  /** A subtitle with no language of its own: "Track n". */
  unknown(n: number): string;
  /** What an audio track that says nothing about itself is called. */
  audio: string;
  /** The word for two channels. */
  stereo: string;
  /** "24-bit" / "24 Bit". */
  bitDepth(depth: number): string;
}

export interface AudioRow {
  /** The track's position in the version's audio list (the server's audio ordinal). */
  index: number;
  track: S['WatchAudioTrack'];
  checked: boolean;
  title: string;
  /** "EAC3", "DD+ Atmos", ...; null when the track names no codec. */
  codec: string | null;
  /** "7.1", "5.1", "Stereo", "4 ch"; null when the channel count is unknown. */
  channels: string | null;
  /** The file marks it as the default track. */
  isDefault: boolean;
  /** Language, layout, bitrate, sample rate and bit depth joined with " · "; may be empty. */
  meta: string;
}

/** The server's address for an audio track: the plan's file and the track's ordinal (protocol §8). */
export const audioIdentity = (plan: Plan, index: number): TrackIdentity => ({
  id: `file:${plan.effective_media_file_id}:audio:${index}`,
  index,
});

/** The audio ordinal the plan plays, or undefined when it names none. */
export const currentAudioIndex = (plan: Plan): number | undefined =>
  trackIndex(plan.selected_tracks.audio);

const joined = (parts: (string | null | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

/**
 * 48000 as "48.000" (German) or "48,000" (English). Grouped by hand: a TV's Chromium may ship
 * without the locale data `toLocaleString` needs.
 */
export function groupThousands(value: number, lang: Language): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+$)/g, lang === 'de' ? '.' : ',');
}

/** "7.1", "5.1", "Stereo" (in the app's language), else "{n} ch"; null for no channel count. */
export function audioChannelsBadge(channels: number | undefined, stereo: string): string | null {
  if (channels === undefined || channels <= 0) return null;
  if (channels === 8) return '7.1';
  if (channels === 6) return '5.1';
  if (channels === 2) return stereo;
  return `${channels} ch`;
}

/** The track's own title, else its embedded title, else "language codec channels", else "Audio". */
function audioTitle(
  track: S['WatchAudioTrack'],
  channels: string | null,
  fallback: string,
): string {
  return (
    track.title ||
    track.embedded_title ||
    [track.language, track.codec, channels].filter(Boolean).join(' ') ||
    fallback
  );
}

export function audioRows(
  plan: Plan,
  media: MediaFacts,
  lang: Language,
  text: TrackText,
): AudioRow[] {
  const current = currentAudioIndex(plan);
  return media.audioTracks.map((track, index) => {
    const channels = audioChannelsBadge(track.channels, text.stereo);
    const title = audioTitle(track, channels, text.audio);
    const language = languageName(track.language, lang);
    return {
      index,
      track,
      checked: index === current,
      title,
      codec: audioCodecBadge(track),
      channels,
      isDefault: track.default,
      meta: joined([
        language && language.toLowerCase() !== title.toLowerCase() ? language : null,
        track.layout,
        track.bitrate && track.bitrate > 0 ? `${groupThousands(track.bitrate, lang)} kbps` : null,
        track.sample_rate && track.sample_rate > 0
          ? `${groupThousands(track.sample_rate, lang)} Hz`
          : null,
        track.bit_depth ? text.bitDepth(track.bit_depth) : null,
      ]),
    };
  });
}

export type SubtitleSource = 'embedded' | 'external' | 'downloaded';

export interface SubtitleRow {
  item: InventoryItem;
  /** The language's name in the app's language, else "Track n". */
  language: string;
  /** "ASS", "SRT", "VTT", "PGS", "DVD" or "DVB"; null for any other codec. */
  format: string | null;
  source: SubtitleSource;
  /** The track's own label ("German (Forced)") when it says more than the language and format. */
  detail: string | null;
  checked: boolean;
}

/** The menu's order: a group keeps the server's order inside. */
const SOURCE_ORDER: readonly SubtitleSource[] = ['embedded', 'external', 'downloaded'];

const sourceOf = (item: InventoryItem): SubtitleSource =>
  SOURCE_ORDER.find((source) => source === item.source) ?? 'embedded';

const FORMATS: Record<string, string> = {
  ass: 'ASS',
  ssa: 'ASS',
  srt: 'SRT',
  subrip: 'SRT',
  vtt: 'VTT',
  webvtt: 'VTT',
  pgs: 'PGS',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'DVD',
  dvb_subtitle: 'DVB',
};

/** The short name of a subtitle format; null for a codec the menu does not name. */
export const subtitleFormat = (codec: string | undefined): string | null =>
  codec ? (FORMATS[codec.toLowerCase()] ?? null) : null;

const plainName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The label line, by the web player's rule: shown when the label is not empty, not the raw
 * language code, not the language's name and not merely the codec's or the format's name.
 */
function subtitleDetail(
  item: InventoryItem,
  name: string | null,
  format: string | null,
): string | null {
  const label = item.label;
  if (!label || label === item.language || label === name) return null;
  const plain = plainName(label);
  const repeatsFormat =
    plain !== '' && (plain === plainName(item.codec ?? '') || plain === plainName(format ?? ''));
  return repeatsFormat ? null : label;
}

/** The plan's subtitle inventory, embedded first, then external, then downloaded. */
export function subtitleRows(plan: Plan, lang: Language, text: TrackText): SubtitleRow[] {
  const selected = plan.selected_tracks.subtitle?.id;
  const rows = plan.subtitle.inventory.map((item) => {
    const name = languageName(item.language, lang);
    const format = subtitleFormat(item.codec);
    return {
      item,
      language: name ?? text.unknown(item.combined_index + 1),
      format,
      source: sourceOf(item),
      detail: subtitleDetail(item, name, format),
      checked: item.track_id === selected,
    };
  });
  // Array.prototype.sort is stable (Chromium 70 and later), so a group keeps the server's order.
  return rows.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
}

/**
 * The tracks a `track_change` for an audio pick names: the new audio and the subtitle the plan plays
 * now (an omitted subtitle means off, so the current one is always sent).
 */
export function tracksForAudioPick(plan: Plan, index: number): SelectedTracks {
  const subtitle = plan.selected_tracks.subtitle;
  return { audio: audioIdentity(plan, index), ...(subtitle ? { subtitle } : {}) };
}

/** The tracks for a subtitle pick (`null` = off, no subtitle member) with the current audio kept. */
export function tracksForSubtitlePick(plan: Plan, item: InventoryItem | null): SelectedTracks {
  const audio = plan.selected_tracks.audio;
  return {
    ...(audio ? { audio } : {}),
    ...(item ? { subtitle: { id: item.track_id, index: item.combined_index } } : {}),
  };
}
