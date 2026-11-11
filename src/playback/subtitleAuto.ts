// Which subtitle a playback starts with, resolved from the profile's subtitle settings the way
// Silo's web player does it. The server never picks one at start: every client resolves it from
// the effective settings and the remembered track, then names it (or changes to it). Pure
// functions over the plan's subtitle inventory; where Silo's clients disagree the web player's
// rule is the one implemented here.
import type { components } from '../api/generated/schema';
import { canonicalLanguageTag } from '../i18n/languages';
import { SUBTITLES } from './deviceProfile';

type S = components['schemas'];
export type InventoryItem = S['SubtitleInventoryItemV3'];
export type SubtitleSignature = S['WatchSubtitleSignature'];
export type SubtitleMode = 'auto' | 'always' | 'off';

/** What the three settings resolve to for one title. */
export interface SubtitleSettings {
  mode: SubtitleMode;
  /** Absent/null: no preference; "": explicitly none; else a BCP 47 tag. */
  language: string | null;
  showForced: boolean;
  /** The track the profile last chose on this title. */
  signature: SubtitleSignature | null;
}

/** The settings registry's values (or the contract's defaults) for keys the watch data omits. */
export interface SubtitleDefaults {
  mode: string;
  language: string | null;
  showForced: boolean;
}

/** The contract's defaults: used when neither the watch data nor the registry has a value. */
export const SUBTITLE_DEFAULTS: SubtitleDefaults = {
  mode: 'auto',
  language: null,
  showForced: true,
};

/** The watch data's merged (series > library > device > profile) subtitle settings. */
export interface SubtitleWatchFields {
  effective_subtitle_mode?: string;
  effective_subtitle_language?: string;
  effective_show_forced_subtitles?: boolean;
  effective_subtitle_track_signature?: SubtitleSignature;
}

/** An unknown or blank mode counts as `auto`. */
const modeOf = (mode: string | undefined): SubtitleMode =>
  mode === 'off' || mode === 'always' || mode === 'auto' ? mode : 'auto';

/**
 * The server only emits an `effective_*` field when a value is stored at some scope, so a missing
 * field means "nothing stored": the registry's value, else the contract default, applies. An empty
 * language is a stored "None" and stays empty.
 */
export function subtitleSettings(
  watch: SubtitleWatchFields,
  fallback: SubtitleDefaults = SUBTITLE_DEFAULTS,
): SubtitleSettings {
  return {
    mode: modeOf(watch.effective_subtitle_mode ?? fallback.mode),
    language:
      watch.effective_subtitle_language !== undefined
        ? watch.effective_subtitle_language
        : fallback.language,
    showForced: watch.effective_show_forced_subtitles ?? fallback.showForced,
    signature: watch.effective_subtitle_track_signature ?? null,
  };
}

/**
 * The language of the audio that plays: the track the plan plays, else (the track names no
 * language) the version's own effective audio language, but only for the track that language was
 * resolved for. Null when unknown.
 */
export function playingAudioLanguage(
  version:
    | {
        audioTracks: readonly { language?: string }[];
        effectiveAudioIndex?: number;
        effectiveAudioLanguage?: string;
      }
    | undefined,
  index: number | undefined,
): string | null {
  if (!version) return null;
  const own = index === undefined ? undefined : version.audioTracks[index]?.language?.trim();
  if (own) return own;
  if (index !== undefined && index !== version.effectiveAudioIndex) return null;
  return version.effectiveAudioLanguage?.trim() || null;
}

const normalized = (value: string | undefined | null): string => (value ?? '').trim().toLowerCase();

/** A language that says something: not blank, not undetermined, not an "original" sentinel. */
function concrete(value: string | undefined | null): string | null {
  const language = normalized(value);
  return language === '' ||
    language === 'und' ||
    language === 'original' ||
    language === 'x-silo-original'
    ? null
    : language;
}

/** The same language, whatever the region or script and whether named by ISO 639-1 or 639-2. */
function sameLanguage(a: string, b: string): boolean {
  const left = canonicalLanguageTag(a)?.split('-')[0];
  return left !== undefined && left === canonicalLanguageTag(b)?.split('-')[0];
}

/**
 * How well a track's language fits the preferred one: 0 the same tag, 1 the track is the bare
 * language, 2 another region or script of it, -1 another language or not a language.
 */
function languageRank(candidate: string | undefined, preferred: string): number {
  const track = canonicalLanguageTag(candidate ?? '');
  const wanted = canonicalLanguageTag(preferred);
  if (!track || !wanted) return -1;
  if (track === wanted) return 0;
  if (!sameLanguage(track, wanted)) return -1;
  return track.includes('-') ? 2 : 1;
}

const BITMAP_CODECS = new Set([
  'pgs',
  'pgssub',
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvdsub',
  'vobsub',
  'dvb_subtitle',
  'dvbsub',
  'dvb_teletext',
]);
const PGS_CODECS = new Set(['pgs', 'pgssub', 'hdmv_pgs_subtitle']);

const isBitmap = (track: InventoryItem): boolean => BITMAP_CODECS.has(normalized(track.codec));

/**
 * An image track is burned into the video unless the device draws it itself. This is the web
 * client's rule with this device's facts, not an app rule: the web player draws embedded PGS, so
 * for it that needs no burn-in; this TV declares `embedded_bitmap` and `sidecar_bitmap` false in
 * its device profile, so here every bitmap track needs one.
 */
const needsBurnIn = (track: InventoryItem): boolean =>
  isBitmap(track) &&
  !(
    PGS_CODECS.has(normalized(track.codec)) &&
    ((track.source || 'embedded') === 'embedded'
      ? SUBTITLES.embedded_bitmap
      : SUBTITLES.sidecar_bitmap)
  );

const SOURCE_RANK: Record<string, number> = { embedded: 0, external: 1, downloaded: 2 };

/**
 * Lower is better, each tier only breaking ties of the one before it: a track the player shows
 * itself beats one that needs a burn-in, full dialogue beats forced, plain beats SDH, text beats an
 * image track, then embedded before external before downloaded. The `default` flag says nothing
 * about what the viewer wants and is not used.
 */
function priority(track: InventoryItem): number {
  return (
    (needsBurnIn(track) ? 32 : 0) +
    (track.forced ? 16 : 0) +
    (track.hearing_impaired ? 8 : 0) +
    (isBitmap(track) ? 4 : 0) +
    (SOURCE_RANK[track.source || 'embedded'] ?? 0)
  );
}

/** The remembered track matches in every field it names. */
function matchesSignature(track: InventoryItem, signature: SubtitleSignature): boolean {
  return (
    normalized(track.source) === normalized(signature.source) &&
    normalized(track.language) === normalized(signature.language) &&
    normalized(track.codec) === normalized(signature.codec) &&
    (normalized(signature.label) === '' ||
      normalized(track.label) === normalized(signature.label)) &&
    track.forced === signature.forced &&
    track.hearing_impaired === signature.hearing_impaired
  );
}

/** How much a track resembles the remembered one: a tie-break within a language. */
function similarity(track: InventoryItem, signature: SubtitleSignature | null): number {
  if (!signature) return 0;
  return (
    (normalized(track.source) === normalized(signature.source) ? 4 : 0) +
    (track.forced === signature.forced ? 2 : 0) +
    (track.hearing_impaired === signature.hearing_impaired ? 2 : 0) +
    (normalized(track.codec) === normalized(signature.codec) ? 1 : 0) +
    (normalized(track.label) === normalized(signature.label) ? 1 : 0)
  );
}

/**
 * The best track in a language: the nearest language rank first, then the likeness to the
 * remembered track, then the priority; the first of equals wins.
 */
function bestInLanguage(
  tracks: readonly InventoryItem[],
  language: string,
  signature: SubtitleSignature | null,
): InventoryItem | null {
  let best: InventoryItem | null = null;
  let bestRank = 3;
  let bestScore = -1;
  let bestPriority = Infinity;
  for (const track of tracks) {
    const rank = languageRank(track.language, language);
    if (rank < 0) continue;
    const score = similarity(track, signature);
    const weight = priority(track);
    if (
      best === null ||
      rank < bestRank ||
      (rank === bestRank && (score > bestScore || (score === bestScore && weight < bestPriority)))
    ) {
      best = track;
      bestRank = rank;
      bestScore = score;
      bestPriority = weight;
    }
  }
  return best;
}

/**
 * The subtitle to play, or null for none.
 * - `off`: only the forced track of the audio's language, and only with "show forced".
 * - `always`: the remembered track when the inventory has it exactly; else the best track of the
 *   preferred language; no language set means none.
 * - `auto`: an explicit "None" gives none. Audio in the preferred language (or no preferred
 *   language) needs no full subtitles, only the audio's forced track; any other audio, or audio of
 *   unknown language, gets the preferred language's best track.
 * `inventory` is the plan's subtitle inventory and `audioLanguage` the language of the audio that
 * plays (null when unknown, which never counts as a match).
 */
export function resolveSubtitle(
  settings: SubtitleSettings,
  inventory: readonly InventoryItem[],
  audioLanguage: string | null,
): InventoryItem | null {
  if (inventory.length === 0) return null;
  const audio = concrete(audioLanguage);
  const preferred = concrete(settings.language);
  const forcedForAudio = (): InventoryItem | null =>
    settings.showForced && audio !== null
      ? bestInLanguage(
          inventory.filter((track) => track.forced),
          audio,
          null,
        )
      : null;

  switch (settings.mode) {
    case 'off':
      return forcedForAudio();
    case 'always': {
      const exact = settings.signature
        ? inventory.find((track) => matchesSignature(track, settings.signature!))
        : undefined;
      if (exact) return exact;
      return preferred === null ? null : bestInLanguage(inventory, preferred, settings.signature);
    }
    case 'auto':
      if (settings.language === '') return null;
      if (preferred === null || (audio !== null && sameLanguage(audio, preferred))) {
        return forcedForAudio();
      }
      return bestInLanguage(inventory, preferred, settings.signature);
  }
}
