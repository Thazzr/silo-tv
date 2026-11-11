// Everything before a plan plays: the server's capabilities (cached per server), the watch data
// of the item, the device profile and the start request with its answer mapped to an outcome.
import { toApiError, type SiloClient } from '../../api/client';
import { toChapters } from '../osd/previewMath';
import { bufferingFields, clientFeatures, type BufferingMode } from './bufferingQuality';
import {
  buildClientCapabilities,
  buildPlaybackContext,
  CLIENT_FEATURES,
  type ClientCapabilities,
  type PlaybackContext,
} from '../deviceProfile';
import { collectProfileProbe } from '../probe';
import { resumePoint } from '../resume';
import type { SubtitleWatchFields } from '../subtitleAuto';
import { trackFields, type Item, type Tracks, type Version } from './facts';
import { SessionError, type Heading, type Plan, type ProfileHeader } from './types';

/** What the capabilities document tells about the server. */
export interface Installation {
  id: string;
  trickplay: boolean;
  /** `marker_segments_v1`: the versions list every marker occurrence, not one per kind. */
  markerList: boolean;
  /** `plan_active_quality_v1`: plans name the quality entry they deliver. */
  activeQuality: boolean;
}

// The server's installation id, per server, for the whole app run. Every mutation carries it.
const installations = new Map<string, Installation>();

/** Test hook. */
export function clearInstallationCache(): void {
  installations.clear();
}

/** The server was replaced or restored: its capabilities are read again on the next load. */
export function forgetInstallation(baseUrl: string): void {
  installations.delete(baseUrl);
}

export async function loadInstallation(
  client: SiloClient,
  baseUrl: string,
  header: ProfileHeader,
): Promise<Installation> {
  const cached = installations.get(baseUrl);
  if (cached) return cached;
  const { data, response } = await client.GET('/api/v2/playback/capabilities', {
    params: { header },
  });
  if (!data) throw new SessionError(response.status === 404 ? 'unsupported' : 'failed');
  const supported =
    data.state === 'available' &&
    data.allowed &&
    data.protocol_versions.includes(3) &&
    data.features.includes('sequenced_progress_v1') &&
    Boolean(data.installation_id);
  if (!supported || !data.installation_id) throw new SessionError('unsupported');
  const known = {
    id: data.installation_id,
    trickplay: data.features.includes('trickplay_v1'),
    markerList: data.features.includes('marker_segments_v1'),
    activeQuality: data.features.includes('plan_active_quality_v1'),
  };
  installations.set(baseUrl, known);
  return known;
}

export interface WatchData {
  fileId: string;
  resume: number | null;
  heading: Heading;
  versions: Version[];
  item: Item;
  /** The title's merged subtitle settings, for choosing the subtitle to start with. */
  subtitles: SubtitleWatchFields;
}

export async function loadWatch(
  client: SiloClient,
  contentId: string,
  pickedFileId: string | undefined,
  header: ProfileHeader,
): Promise<WatchData> {
  const { data, error, response } = await client.GET('/api/v2/watch/{id}', {
    params: { path: { id: contentId }, header },
  });
  if (!data) throw toApiError(error, response);
  // The file the viewer picked, else the one watched last, else the first.
  const wanted = pickedFileId ?? data.user_data?.last_file_id;
  const version = data.versions.find((v) => v.file_id === wanted) ?? data.versions[0];
  if (!version) throw new SessionError('noFile');
  // One rule for every entry: the detail page's. A rewatch that stopped partway resumes too.
  const resume = resumePoint(data.user_data, version.duration_seconds);
  const heading: Heading = {
    title: data.title,
    ...(data.series_title ? { seriesTitle: data.series_title } : {}),
    ...(data.season_number !== undefined ? { seasonNumber: data.season_number } : {}),
    ...(data.episode_number !== undefined ? { episodeNumber: data.episode_number } : {}),
  };
  const versions = data.versions.map((v) => ({
    fileId: v.file_id,
    trickplay: v.trickplay_available,
    chapters: toChapters(v.chapters),
    markers: {
      marker_segments: v.marker_segments,
      intro: v.intro,
      recap: v.recap,
      credits: v.credits,
      preview: v.preview,
    },
    videoCodec: v.codec_video,
    resolution: v.resolution,
    hdr: v.hdr,
    container: v.container,
    fileSize: v.file_size,
    bitrateKbps: v.bitrate,
    ...(v.edition_raw || v.edition_key ? { edition: v.edition_raw || v.edition_key } : {}),
    audioTracks: v.audio_tracks ?? [],
    subtitleTracks: v.subtitle_tracks ?? [],
    ...(v.effective_audio_track_index !== undefined
      ? { effectiveAudioIndex: v.effective_audio_track_index }
      : {}),
    ...(v.effective_audio_language ? { effectiveAudioLanguage: v.effective_audio_language } : {}),
  }));
  const item: Item = {
    isEpisode: data.type === 'episode',
    ...(data.series_id ? { seriesId: data.series_id } : {}),
    ...(data.year !== undefined ? { year: data.year } : {}),
  };
  const subtitles: SubtitleWatchFields = {
    effective_subtitle_mode: data.effective_subtitle_mode,
    effective_subtitle_language: data.effective_subtitle_language,
    effective_show_forced_subtitles: data.effective_show_forced_subtitles,
    effective_subtitle_track_signature: data.effective_subtitle_track_signature,
  };
  return { fileId: version.file_id, resume, heading, versions, item, subtitles };
}

/** What the device can play and the context it plays in, read from the TV. */
export async function readDeviceProfile(): Promise<{
  capabilities: ClientCapabilities;
  context: PlaybackContext;
}> {
  const probe = await collectProfileProbe();
  return { capabilities: buildClientCapabilities(probe), context: buildPlaybackContext(probe) };
}

export interface StartRequest {
  installationId: string;
  fileId: string;
  /** A file the viewer picked is the one to play, not one of its alternate versions. */
  pinnedFile: boolean;
  profileId: string;
  attemptId: string;
  quality: string;
  /** The profile's bitrate cap in kbit/s; null sends nothing. */
  bandwidthCapKbps?: number | null;
  /** The buffering-quality setting and whether the server knows it; absent = `always`, unknown. */
  buffering?: { feature: boolean; mode: BufferingMode };
  position: number;
  tracks: Tracks;
  capabilities: ClientCapabilities;
  context: PlaybackContext;
}

export function requestStart(client: SiloClient, header: ProfileHeader, start: StartRequest) {
  const buffering = start.buffering ?? { feature: false, mode: 'always' as const };
  return client.POST('/api/v2/playback/start', {
    params: { header },
    body: {
      installation_id: start.installationId,
      protocol_version: 3,
      client_features: clientFeatures(CLIENT_FEATURES, buffering.feature),
      file_id: start.fileId,
      // A file the viewer picked is the one to play, not one of its alternate versions.
      ...(start.pinnedFile ? { allow_alternate_versions: false } : {}),
      profile_id: start.profileId,
      playback_attempt_id: start.attemptId,
      quality_preference: start.quality,
      ...(start.bandwidthCapKbps != null ? { bandwidth_cap_kbps: start.bandwidthCapKbps } : {}),
      // A start carries no kept estimate: only the mode's learned-limit control.
      ...bufferingFields({ ...buffering, auto: start.quality === 'auto', keptKbps: null }),
      subtitle_fidelity_preference: 'compatible',
      start_position: start.position,
      // Left out unless the viewer picked one: then the server decides from the preferences.
      ...trackFields(start.tracks),
      client_capabilities: start.capabilities,
      client_playback_context: start.context,
    },
  });
}

/** What the server's answer to a start means for the session. */
export type StartOutcome =
  | { kind: 'playable'; plan: Plan; sessionId: string }
  | { kind: 'terminal'; message?: string; reason?: string }
  /** The server was replaced or restored: read its capabilities again, new attempt. */
  | { kind: 'installationChanged' }
  | { kind: 'failed'; reason: 'unsupported' | 'failed' };

export function interpretStart(
  answer: Awaited<ReturnType<typeof requestStart>>,
  retryInstallation: boolean,
): StartOutcome {
  const { data, error, response } = answer;
  if (!data) {
    const problem = toApiError(error, response);
    if (problem.code === 'installation_changed' && retryInstallation) {
      return { kind: 'installationChanged' };
    }
    return { kind: 'failed', reason: response.status === 426 ? 'unsupported' : 'failed' };
  }
  const sessionId = data.session_id ?? data.playback_plan?.session_id;
  if (data.outcome === 'playable' && data.playback_plan && sessionId) {
    return { kind: 'playable', plan: data.playback_plan, sessionId };
  }
  return { kind: 'terminal', message: data.terminal?.message, reason: data.terminal?.reason };
}
