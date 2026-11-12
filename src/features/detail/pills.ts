// What the version, audio and subtitle pills of a movie or episode page say and list, as pure
// functions over the selected file. The player's menus are built on its plan; these are built on
// the file's own track lists (`FileVersion`), the way Silo's web app builds its detail pills.
import type { components } from '../../api/generated/schema';
import type { Language, MessageKey } from '../../i18n';
import { languageName } from '../../i18n/languages';
import { audioCodecBadge } from '../../playback/audioLabel';
import type { StartChoices } from '../../playback/resume';
import { formatBitrate, formatFileSize } from '../../playback/menus/infoFormat';
import {
  audioChannelsBadge,
  groupThousands,
  subtitleFormat,
} from '../../playback/menus/trackMenus';
import {
  resolveSubtitle,
  type InventoryItem,
  type SubtitleSettings,
} from '../../playback/subtitleAuto';
import { videoRangeLabel } from './info';
import type { FileVersion } from './versions';

type S = components['schemas'];
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const SEPARATOR = ' · ';
const joined = (parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(SEPARATOR);
const positive = (value: number | undefined): value is number => value !== undefined && value > 0;

/** The name of a track's language in the app's language; "Unknown" for none (also `und`). */
function trackLanguage(code: string | undefined, lang: Language, t: Translate): string {
  const named = code?.trim().toLowerCase() === 'und' ? null : languageName(code, lang);
  return named ?? t('detail.pill.unknown');
}

// ---- Version and edition ------------------------------------------------------------------------

/** The audio label of the file's own codec; the first track's profile and titles tell Atmos. */
function fileAudioLabel(version: FileVersion): string | null {
  const first = version.audio_tracks?.[0];
  const sameStream = first?.codec?.toLowerCase() === version.codec_audio.toLowerCase();
  return audioCodecBadge({ codec: version.codec_audio, ...(sameStream ? first : {}) });
}

/** "2160p · HEVC · HDR10 · DTS": what a file is, in one line; its container when nothing else says. */
export function versionSummary(version: FileVersion): string {
  const parts = [
    version.resolution,
    version.codec_video.toUpperCase(),
    videoRangeLabel(version),
    fileAudioLabel(version),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(SEPARATOR) : version.container.toUpperCase();
}

/** "MKV · 4.2 GB · 12.3 Mbit/s": the line under a file's summary. */
export function versionDetail(version: FileVersion, lang: Language): string {
  const decimal = lang === 'de' ? ',' : '.';
  return joined([
    version.container.toUpperCase(),
    formatFileSize(version.file_size, decimal),
    formatBitrate(version.bitrate, decimal),
  ]);
}

/** What a file is called on its pill: its summary, else its detail line, else "Version {id}". */
export function versionLabel(version: FileVersion, lang: Language, t: Translate): string {
  return (
    versionSummary(version) ||
    versionDetail(version, lang) ||
    t('detail.pill.fileFallback', { id: version.file_id })
  );
}

/** "2 versions · 2160p · HEVC": the line under an edition's name. */
export function editionDetail(count: number, standing: FileVersion, t: Translate): string {
  return joined([count > 1 && t('detail.pill.versionCount', { count }), versionSummary(standing)]);
}

// ---- Audio --------------------------------------------------------------------------------------

type AudioTrack = S['AudioTrack'];

/**
 * The track Auto plays: the one the server resolved for the profile when it is in the list, else
 * the file's default track, else the first.
 */
export function autoAudioIndex(version: FileVersion): number {
  const tracks = version.audio_tracks ?? [];
  const resolved = version.effective_audio_track_index;
  if (resolved !== undefined && resolved >= 0 && resolved < tracks.length) return resolved;
  const standing = tracks.findIndex((track) => track.default);
  return standing >= 0 ? standing : 0;
}

/** "German · EAC3 · 5.1": a track in one line. */
export function audioSummary(track: AudioTrack, lang: Language, t: Translate): string {
  return joined([
    trackLanguage(track.language, lang, t),
    audioCodecBadge(track),
    audioChannelsBadge(track.channels, t('player.menu.audio.stereo')),
  ]);
}

export interface AudioRow {
  /** The track's position in the file's audio list: what a pick saves and plays. */
  index: number;
  title: string;
  /** "EAC3", "DD+ Atmos", ...; null when the track names no codec. */
  codec: string | null;
  /** "5.1", "Stereo", ...; null when the channel count is unknown. */
  channels: string | null;
  isDefault: boolean;
  /** The track's own title when it says more, then layout, bitrate, sample rate and bit depth. */
  meta: string;
}

export function audioRows(version: FileVersion, lang: Language, t: Translate): AudioRow[] {
  const stereo = t('player.menu.audio.stereo');
  return (version.audio_tracks ?? []).map((track, index) => {
    const channels = audioChannelsBadge(track.channels, stereo);
    const named = track.language?.trim() ? trackLanguage(track.language, lang, t) : null;
    const title =
      named ||
      track.title ||
      track.embedded_title ||
      [track.language, track.codec, channels].filter(Boolean).join(' ') ||
      t('player.menu.audio.generic');
    const embedded = track.title?.trim() || track.embedded_title?.trim() || '';
    return {
      index,
      title,
      codec: audioCodecBadge(track),
      channels,
      isDefault: track.default,
      meta: joined([
        embedded !== title && embedded,
        track.layout,
        positive(track.bitrate) && `${groupThousands(track.bitrate, lang)} kbps`,
        positive(track.sample_rate) && `${groupThousands(track.sample_rate, lang)} Hz`,
        positive(track.bit_depth) && t('player.menu.audio.bitDepth', { depth: track.bit_depth }),
      ]),
    };
  });
}

// ---- Subtitles ----------------------------------------------------------------------------------

export type SubtitleSource = 'embedded' | 'external' | 'downloaded';

/** What the viewer chose for the subtitle: Auto, Off, or one track of the lists (by its key). */
export type SubtitlePick = { mode: 'auto' } | { mode: 'off' } | { mode: 'track'; key: string };

export interface SubtitleRow {
  /** Unique within the file; also the row's focus key. */
  key: string;
  source: SubtitleSource;
  /** The language's name in the app's language ("Unknown" for none). */
  language: string;
  /** "SRT", "PGS", ...: the short format name, else the codec in capitals. */
  format: string | null;
  forced: boolean;
  hearingImpaired: boolean;
  isDefault: boolean;
  /** The track's title, or what a downloaded one was released as; null when it adds nothing. */
  description: string | null;
  /**
   * The row in the shape of the plan's subtitle inventory, so the player's rule picks the Auto
   * track from it and the player's writer saves it. A downloaded track has no ordinal before a
   * plan exists: its `combined_index` is -1.
   */
  item: InventoryItem;
}

export interface SubtitleLists {
  embedded: SubtitleRow[];
  external: SubtitleRow[];
  downloaded: SubtitleRow[];
  /** All rows in the order Auto searches them: embedded, external, downloaded. */
  all: SubtitleRow[];
}

const plain = (value: string | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Titles that only say what the flags already say; a track so titled is forced or for the hearing
// impaired even when its flag is not set.
const FORCED_TITLES = ['forced'];
const HEARING_TITLES = ['sdh', 'cc', 'hi', 'hearing impaired'];

/** The description line: the track's title, unless it is a flag word or only names the format. */
function descriptionOf(
  title: string | undefined,
  codec: string | undefined,
  format: string | null,
): string | null {
  const lower = title?.toLowerCase() ?? '';
  if (!title || FORCED_TITLES.includes(lower) || HEARING_TITLES.includes(lower)) return null;
  const name = plain(title);
  return name === plain(codec) || name === plain(format ?? '') ? null : title;
}

const byText = (a: string | undefined, b: string | undefined): number =>
  (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });

const formatOf = (codec: string | undefined): string | null =>
  subtitleFormat(codec) ?? (codec?.trim() ? codec.trim().toUpperCase() : null);

/**
 * The file's subtitle tracks (embedded and external, in the file's order, then sorted by language,
 * forced first, default first) and the downloaded ones (best score first), as rows.
 */
export function subtitleLists(
  version: FileVersion,
  downloaded: readonly S['StoredSubtitle'][],
  lang: Language,
  t: Translate,
): SubtitleLists {
  const tracks = version.subtitle_tracks ?? [];
  // The plan numbers the tracks with the sidecar files first, then the embedded ones.
  const ordinals = [
    ...tracks.filter((track) => track.external),
    ...tracks.filter((track) => !track.external),
  ];
  const builtIn = tracks.map((track): SubtitleRow => {
    const source: SubtitleSource = track.external ? 'external' : 'embedded';
    const ordinal = ordinals.indexOf(track);
    const code = track.language?.trim() ?? '';
    const title = track.title?.trim() || track.embedded_title?.trim() || track.file_name?.trim();
    const format = formatOf(track.codec);
    const lowerTitle = title?.toLowerCase() ?? '';
    return {
      key: `${source}:${ordinal}`,
      source,
      language: trackLanguage(code, lang, t),
      format,
      forced: track.forced || FORCED_TITLES.includes(lowerTitle),
      hearingImpaired: track.hearing_impaired || HEARING_TITLES.includes(lowerTitle),
      isDefault: track.default,
      description: descriptionOf(title, track.codec, format),
      item: {
        track_id: `${source}:${ordinal}`,
        combined_index: ordinal,
        source,
        language: code,
        codec: track.codec?.trim(),
        label: title || code || `Subtitle ${ordinal + 1}`,
        forced: track.forced,
        hearing_impaired: track.hearing_impaired,
        default: track.default,
        delivery: '',
      },
    };
  });
  const sortBuiltIn = (source: SubtitleSource): SubtitleRow[] =>
    builtIn
      .filter((row) => row.source === source)
      .sort(
        (a, b) =>
          byText(a.language, b.language) ||
          Number(b.forced) - Number(a.forced) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          byText(a.item.label, b.item.label),
      );

  const stored = [...downloaded]
    .sort(
      (a, b) =>
        b.score - a.score ||
        byText(a.provider, b.provider) ||
        byText(a.release_name, b.release_name),
    )
    .map((subtitle): SubtitleRow => {
      const code = subtitle.language.trim();
      const release = subtitle.release_name.trim();
      const provider = subtitle.provider.trim();
      const format = formatOf(subtitle.format);
      return {
        key: `downloaded:${subtitle.id}`,
        source: 'downloaded',
        language: trackLanguage(code, lang, t),
        format,
        forced: false,
        hearingImpaired: subtitle.hearing_impaired,
        isDefault: false,
        description: release || null,
        item: {
          track_id: `downloaded:${subtitle.id}`,
          combined_index: -1,
          source: 'downloaded',
          language: code,
          codec: subtitle.format.trim() || undefined,
          label: release && provider ? `${release} (${provider})` : release || provider || code,
          forced: false,
          hearing_impaired: subtitle.hearing_impaired,
          default: false,
          delivery: '',
        },
      };
    });

  const embedded = sortBuiltIn('embedded');
  const external = sortBuiltIn('external');
  return { embedded, external, downloaded: stored, all: [...embedded, ...external, ...stored] };
}

/** The Auto track: what the profile's subtitle settings resolve to for the audio that plays. */
export function autoSubtitle(
  lists: SubtitleLists,
  settings: SubtitleSettings,
  audioLanguage: string | null,
): SubtitleRow | undefined {
  const found = resolveSubtitle(
    settings,
    lists.all.map((row) => row.item),
    audioLanguage,
  );
  return lists.all.find((row) => row.item === found);
}

/** "German (Forced) · SRT": a track in one line; the markers only when the name lacks them. */
export function subtitleSummary(row: SubtitleRow, t: Translate): string {
  const name = row.language;
  const parts = [name];
  if (row.hearingImpaired && !/\b(?:sdh|cc|hi)\b/i.test(name))
    parts.push(t('detail.pill.sdhMarker'));
  if (row.forced && !/forced/i.test(name)) parts.push(t('detail.pill.forcedMarker'));
  return joined([parts.join(' '), row.format]);
}

export interface SubtitlePill {
  /** The pill's value. */
  summary: string;
  /** The Auto row's second line. */
  autoDescription: string;
  /** Which row is checked: Auto, Off, or a track. */
  checked: { mode: 'auto' } | { mode: 'off' } | { mode: 'track'; key: string };
}

/**
 * The subtitle pill's value and checks. With a saved override (the profile chose a track on this
 * title before) Auto is not the choice any more: the pill names the track the override resolves
 * to, that row is checked, and the Auto row offers to reset to the profile's defaults.
 */
export function subtitlePill(
  pick: SubtitlePick,
  lists: SubtitleLists,
  auto: SubtitleRow | undefined,
  saved: boolean,
  t: Translate,
): SubtitlePill {
  const chosen = pick.mode === 'track' ? lists.all.find((row) => row.key === pick.key) : undefined;
  if (pick.mode === 'off') {
    return {
      summary: t('player.menu.subtitles.off'),
      autoDescription: autoOf(auto, t),
      checked: pick,
    };
  }
  if (chosen) {
    return {
      summary: subtitleSummary(chosen, t),
      autoDescription: autoOf(auto, t),
      checked: { mode: 'track', key: chosen.key },
    };
  }
  if (saved && auto) {
    return {
      summary: subtitleSummary(auto, t),
      autoDescription: t('detail.pill.resetToDefaults'),
      checked: { mode: 'track', key: auto.key },
    };
  }
  return {
    summary: t('detail.pill.autoSummary', {
      summary: auto ? subtitleSummary(auto, t) : t('player.menu.subtitles.off'),
    }),
    autoDescription: autoOf(auto, t),
    checked: { mode: 'auto' },
  };
}

/** The Auto row's second line: what the pill says for Auto, without its "Auto:" prefix. */
const autoOf = (auto: SubtitleRow | undefined, t: Translate): string =>
  auto ? subtitleSummary(auto, t) : t('player.menu.subtitles.off');

/**
 * What the player's start is told about the page's picks, so Play starts what the pills show.
 * The file is named (and so kept to, with no alternate version planned) when the viewer picked
 * one, or when a track index goes along: an index belongs to one file's track list. Auto leaves a
 * choice to the player. Off names an empty subtitle, so the settings do not choose one. A
 * downloaded track has no ordinal before the plan exists; the saved preference carries it.
 */
export function startChoices(
  version: FileVersion | undefined,
  versionPicked: boolean,
  audio: number | null,
  subtitle: SubtitlePick,
  lists: SubtitleLists,
): StartChoices {
  if (!version) return {};
  const row =
    subtitle.mode === 'track' ? lists.all.find((one) => one.key === subtitle.key) : undefined;
  const ordinal = row && row.item.combined_index >= 0 ? row.item.combined_index : undefined;
  const pinned = versionPicked || audio !== null || ordinal !== undefined;
  return {
    ...(pinned ? { fileId: version.file_id } : {}),
    ...(audio !== null ? { audio: { index: audio } } : {}),
    ...(subtitle.mode === 'off' ? { subtitle: {} } : {}),
    ...(ordinal !== undefined ? { subtitle: { index: ordinal } } : {}),
  };
}
