// Pure functions over the watch data and the plan: the facts the overlay and the options panel
// show, and the small checks the controller makes on positions and track picks.
import type { Chapter } from '../osd/previewMath';
import type { TrackChoice } from '../resume';
import { segmentsOf, type MarkerFields } from '../skip/segments';
import type { MediaFacts, Plan, PreviewFacts, S } from './types';

/** The largest position taken at its word: webOS reports INT64_MAX nanoseconds for "unknown". */
const MAX_PLAUSIBLE_SECONDS = 1e7;

export interface Version {
  fileId: string;
  trickplay: boolean;
  chapters: Chapter[];
  markers: MarkerFields;
  videoCodec: string;
  resolution: string;
  hdr: boolean;
  container: string;
  fileSize: number;
  bitrateKbps: number;
  edition?: string;
  audioTracks: S['WatchAudioTrack'][];
  subtitleTracks: S['WatchSubtitleTrack'][];
  /** The audio track the server resolved for the profile, and its language. */
  effectiveAudioIndex?: number;
  effectiveAudioLanguage?: string;
}

/** The item itself, from the watch projection. */
export interface Item {
  isEpisode: boolean;
  seriesId?: string;
  year?: number;
}

/** A track pick as the start request carries it. */
export interface Tracks {
  audio?: TrackChoice;
  subtitle?: TrackChoice;
}

export function plausible(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_PLAUSIBLE_SECONDS;
}

export function inRanges(ranges: { start: number; end: number }[], time: number): boolean {
  return ranges.some((range) => time >= range.start && time <= range.end);
}

export function trackFields(tracks: Tracks) {
  return {
    ...(tracks.audio?.id !== undefined ? { audio_track_id: tracks.audio.id } : {}),
    ...(tracks.audio?.index !== undefined ? { audio_track_index: tracks.audio.index } : {}),
    ...(tracks.subtitle?.id !== undefined ? { subtitle_track_id: tracks.subtitle.id } : {}),
    ...(tracks.subtitle?.index !== undefined
      ? { subtitle_track_index: tracks.subtitle.index }
      : {}),
  };
}

/** The item and the played version's facts for the options panel. */
export function mediaFacts(plan: Plan, versions: Version[], item: Item): MediaFacts {
  const fileId = plan.effective_media_file_id;
  const version = versions.find((v) => v.fileId === fileId);
  return {
    fileId,
    isEpisode: item.isEpisode,
    ...(item.seriesId ? { seriesId: item.seriesId } : {}),
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(version?.videoCodec ? { videoCodec: version.videoCodec } : {}),
    ...(version?.resolution ? { resolution: version.resolution } : {}),
    hdr: version?.hdr === true,
    ...(version?.container ? { container: version.container } : {}),
    ...(version?.fileSize ? { fileSize: version.fileSize } : {}),
    ...(version?.bitrateKbps ? { bitrateKbps: version.bitrateKbps } : {}),
    versionCount: versions.length,
    ...(version?.edition ? { edition: version.edition } : {}),
    audioTracks: version?.audioTracks ?? [],
    subtitleTracks: version?.subtitleTracks ?? [],
  };
}

/**
 * Chapters, previews and skippable segments of the file the plan plays (an alternate version may
 * differ from the picked one).
 */
export function previewFacts(
  plan: Plan,
  versions: Version[],
  server: { trickplay: boolean; markerList: boolean },
): PreviewFacts {
  const fileId = plan.effective_media_file_id;
  // Only the exact file: another version's chapters and previews would not match its timeline.
  const version = versions.find((v) => v.fileId === fileId);
  return {
    fileId,
    trickplay: server.trickplay && version?.trickplay === true,
    chapters: version?.chapters ?? [],
    segments: version ? segmentsOf(version.markers, server.markerList) : [],
  };
}
