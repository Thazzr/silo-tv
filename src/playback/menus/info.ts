// What the Info panel says about the title and the stream, as pure functions. Nothing here reads or
// returns a path, a file name, a URL or a token.
import type { Language } from '../../i18n';
import { isLanguageWord, languageName } from '../../i18n/languages';
import { isHlsStream } from '../engine/PlayerEngine';
import type { Chapter } from '../osd/previewMath';
import { isAudioCodecWord } from './infoFormat';
import type { Heading, MediaFacts, Plan } from '../session/types';

export type Route = 'direct' | 'remux' | 'transcode';

/**
 * How the bytes reach the player, from the plan's `delivery`. Null for a delivery this app does
 * not know.
 */
export function routeOf(delivery: string): Route | null {
  switch (delivery) {
    case 'original_http':
      return 'direct';
    case 'server_remux_progressive':
    case 'server_remux_hls':
      return 'remux';
    case 'server_transcode_hls':
      return 'transcode';
    default:
      return null;
  }
}

/** The track's index from a plan identity: its `index`, else the number at the end of its id. */
function trackIndex(identity: { id: string; index?: number } | undefined): number | undefined {
  if (!identity) return undefined;
  if (identity.index !== undefined) return identity.index;
  const tail = /(\d+)$/.exec(identity.id)?.[1];
  return tail === undefined ? undefined : Number(tail);
}

/** The audio track the plan plays, from the version's track list; undefined when none lists it. */
export function selectedAudio(
  plan: Plan,
  media: MediaFacts,
): MediaFacts['audioTracks'][number] | undefined {
  const index = trackIndex(plan.selected_tracks.audio);
  return index === undefined ? undefined : media.audioTracks[index];
}

const CHANNEL_WORD = /^(\d(\.\d)?|\d+ch|ch|channels?|stereo|mono|surround|atmos)$/i;

/**
 * An audio track's title when it says more than the language, the codec and the channel layout
 * ("GER - AC3" and "Surround 5.1" say nothing new; "Director's Commentary" does); else null.
 */
export function informativeTitle(title: string | null | undefined): string | null {
  const text = title?.trim();
  if (!text) return null;
  const words = text.split(/[\s·,/|]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const adds = words.some(
    (word) => !(isLanguageWord(word) || isAudioCodecWord(word) || CHANNEL_WORD.test(word)),
  );
  return adds ? text : null;
}

/**
 * The selected subtitle, or null when the plan plays none. `label` is null for a track the plan
 * names but no list describes (the caller words that as plain "on"). A track's own title wins;
 * a bare language code becomes the language's name.
 */
export function subtitleChoice(
  plan: Plan,
  media: MediaFacts,
  lang: Language,
): { label: string | null } | null {
  const selected = plan.selected_tracks.subtitle;
  if (!selected) return null;
  const inventory = plan.subtitle.inventory.find((item) => item.track_id === selected.id);
  const index = trackIndex(selected);
  const listed = media.subtitleTracks.find((track) => track.index === index);
  const label =
    inventory?.label ||
    listed?.title ||
    listed?.embedded_title ||
    languageName(inventory?.language || listed?.language, lang) ||
    null;
  return { label };
}

/** The chapter that plays at `position`: the last one whose start has passed. */
export function currentChapter(chapters: readonly Chapter[], position: number): number {
  let current = -1;
  chapters.forEach((chapter, index) => {
    if (chapter.start <= position) current = index;
  });
  return current;
}

/** The episode's numbers as "S1 · E2"; null for anything else. */
export function episodeCode(heading: Heading | null): string | null {
  const parts: string[] = [];
  if (heading?.seasonNumber !== undefined) parts.push(`S${heading.seasonNumber}`);
  if (heading?.episodeNumber !== undefined) parts.push(`E${heading.episodeNumber}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What a plan's stream is made of: one file, or HLS in MPEG-TS or fragmented MP4 segments. */
export type StreamKind = 'file' | 'hlsTs' | 'hlsFmp4' | 'hls';

export function streamKind(plan: Plan): StreamKind {
  if (!isHlsStream(plan.stream)) return 'file';
  const container = plan.effective_recipe.segment_container?.trim().toLowerCase();
  if (container === 'mpegts' || container === 'ts') return 'hlsTs';
  if (container === 'fmp4' || container === 'mp4') return 'hlsFmp4';
  return 'hls';
}

/** The reasons the Info words, from the plan's `decision_reason` and its transformations. */
export type ReasonId =
  | 'direct'
  | 'quality'
  | 'qualityAuto'
  | 'qualityOriginal'
  | 'qualityDevice'
  | 'qualityBandwidth'
  | 'qualityCap'
  | 'container'
  | 'audio'
  | 'video'
  | 'packaging'
  | 'burnIn'
  | 'dolbyVision'
  | 'managedRange'
  | 'dolbyBase'
  | 'noEvidence';

const QUALITY_REASONS = new Set<ReasonId>([
  'quality',
  'qualityAuto',
  'qualityOriginal',
  'qualityDevice',
  'qualityBandwidth',
  'qualityCap',
]);

/** The documented `decision_reason` values (protocol v3 §7.1); an unknown one maps to nothing. */
const DECISION: Record<string, ReasonId> = {
  validated_original_playback: 'direct',
  container_normalization: 'container',
  audio_adaptation: 'audio',
  hls_audio_adaptation: 'audio',
  hls_packaging_required: 'packaging',
  subtitle_burn_in_required: 'burnIn',
  client_dv7_to_dv81: 'dolbyVision',
  client_dv7_to_hdr10: 'dolbyVision',
  client_managed_dynamic_range: 'managedRange',
  client_dv8_base_layer: 'dolbyBase',
  evidence_insufficient_for_direct: 'noEvidence',
  quality_auto_source: 'qualityAuto',
  quality_fixed_rung: 'quality',
  quality_device_limit: 'qualityDevice',
  quality_bandwidth_limit: 'qualityBandwidth',
  quality_bandwidth_cap: 'qualityCap',
  quality_original: 'qualityOriginal',
};

const hasTransformation = (plan: Plan, prefix: string): boolean =>
  (plan.transformations ?? []).some((item) => item.name.startsWith(prefix));

/**
 * Why the server picked this route, as the reasons to say: the decision reason first, then what
 * the transformations add. A value this app does not know is left out, never shown as a code.
 */
export function reasonsOf(plan: Plan): ReasonId[] {
  const out: ReasonId[] = [];
  const primary = DECISION[plan.decision_reason];
  if (primary) out.push(primary);
  const quality = primary !== undefined && QUALITY_REASONS.has(primary);
  // A chosen quality already says the video is re-encoded.
  if (hasTransformation(plan, 'video_') && !quality) out.push('video');
  if (hasTransformation(plan, 'audio_')) out.push('audio');
  return out.filter((reason, at) => out.indexOf(reason) === at);
}

/** Whether the stream's video and audio are converted, or arrive as the file has them. */
export function conversions(plan: Plan): { video: boolean; audio: boolean } {
  const recipe = plan.effective_recipe;
  const source = plan.source;
  const differs = (a: string | undefined, b: string | undefined) =>
    a !== undefined && b !== undefined && a.toLowerCase() !== b.toLowerCase();
  const differsNumber = (a: number | undefined, b: number | undefined) =>
    a !== undefined && b !== undefined && a !== b;
  return {
    video:
      routeOf(plan.delivery) === 'transcode' ||
      hasTransformation(plan, 'video_') ||
      differs(recipe.video_codec, source.video_codec) ||
      differsNumber(recipe.height, source.height),
    audio:
      hasTransformation(plan, 'audio_') ||
      differs(recipe.audio_codec, source.audio_codec) ||
      differsNumber(recipe.audio_channels, source.audio_channels),
  };
}

/**
 * The source file's dynamic range as it is written: "SDR", "HDR10", "HDR10+", "HLG", or
 * "Dolby Vision 8.1" (profile.base-layer compatibility id) when the file carries one.
 */
export function dynamicRangeName(source: Plan['source'], hdr: boolean): string {
  const profile = source.dolby_vision_profile;
  if (profile) {
    const compat = source.dv_bl_compat_id;
    return compat !== undefined ? `Dolby Vision ${profile}.${compat}` : `Dolby Vision ${profile}`;
  }
  const range = source.dynamic_range?.toLowerCase().replace(/[^a-z0-9+]/g, '') ?? '';
  if (source.hdr10_plus || range === 'hdr10+' || range === 'hdr10plus') return 'HDR10+';
  if (range === 'hlg') return 'HLG';
  if (range === 'hdr10' || range === 'pq') return 'HDR10';
  if (range === 'sdr') return 'SDR';
  return hdr ? 'HDR' : 'SDR';
}
