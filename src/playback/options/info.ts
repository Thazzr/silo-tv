// What the Info tab says about the title and the stream, as pure functions. Nothing here reads or
// returns a path, a URL or a token.
import type { Chapter } from '../osd/previewMath';
import type { MediaFacts, Plan } from '../usePlaybackSession';

export type Route = 'direct' | 'remux' | 'transcode';

/**
 * How the bytes reach the player, from the plan's `delivery` (the value PlayerDiagnostics shows
 * as it is). Null for a delivery this app does not know.
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

/** "5.1" for six channels, "7.1" for eight, "2.0" for stereo; other counts as "n ch". */
export function channelText(channels: number | undefined): string | null {
  if (!channels || channels <= 0) return null;
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  if (channels <= 2) return `${channels}.0`;
  return `${channels} ch`;
}

const present = (parts: (string | null | undefined)[]): string[] =>
  parts.filter((part): part is string => Boolean(part && part.trim()));

/** The track's index from a plan identity: its `index`, else the number at the end of its id. */
function trackIndex(identity: { id: string; index?: number } | undefined): number | undefined {
  if (!identity) return undefined;
  if (identity.index !== undefined) return identity.index;
  const tail = /(\d+)$/.exec(identity.id)?.[1];
  return tail === undefined ? undefined : Number(tail);
}

/** "en · EAC3 · 5.1": the selected audio track's language, codec and channels; null when unknown. */
export function audioText(plan: Plan, media: MediaFacts): string | null {
  const index = trackIndex(plan.selected_tracks.audio);
  const track = index === undefined ? undefined : media.audioTracks[index];
  if (!track) return null;
  const language = track.language && track.language !== 'und' ? track.language : null;
  const text = present([
    language ?? track.title,
    track.codec?.toUpperCase(),
    channelText(track.channels),
  ]);
  return text.length > 0 ? text.join(' · ') : null;
}

/**
 * The selected subtitle, or null when the plan plays none. `label` is null for a track the plan
 * names but no list describes (the caller words that as plain "on").
 */
export function subtitleText(plan: Plan, media: MediaFacts): { label: string | null } | null {
  const selected = plan.selected_tracks.subtitle;
  if (!selected) return null;
  const inventory = plan.subtitle.inventory.find((item) => item.track_id === selected.id);
  const index = trackIndex(selected);
  const listed = media.subtitleTracks.find((track) => track.index === index);
  const label =
    inventory?.label ||
    listed?.title ||
    listed?.embedded_title ||
    inventory?.language ||
    listed?.language ||
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

/** The video line: codec, resolution and HDR, as far as they are known. */
export function videoText(plan: Plan, media: MediaFacts): string | null {
  const codec = plan.effective_recipe.video_codec ?? media.videoCodec ?? plan.source.video_codec;
  const text = present([
    codec ? codec.toUpperCase() : null,
    media.resolution,
    media.hdr ? 'HDR' : null,
  ]);
  return text.length > 0 ? text.join(' · ') : null;
}
