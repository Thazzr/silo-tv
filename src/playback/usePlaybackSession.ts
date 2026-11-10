// One playback through Silo playback protocol v3: capabilities, start, progress, replans (failure
// recovery, reconnect, seek, track and quality changes) and stop. The controller is plain
// TypeScript so the protocol logic does not depend on React; usePlaybackSession ties its lifetime
// to a component. It drives the player only through the PlayerEngine interface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toApiError, type SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import type { Session } from '../api/session';
import { useSilo } from '../app/SiloContext';
import {
  buildClientCapabilities,
  buildPlaybackContext,
  CLIENT_FEATURES,
  type ClientCapabilities,
  type PlaybackContext,
} from './deviceProfile';
import type { PlayerEngine } from './engine/PlayerEngine';
import { mediaUrlWithToken } from './mediaUrl';
import { toChapters, type Chapter } from './osd/previewMath';
import { collectProfileProbe } from './probe';
import { resumePoint, rewound, type StartIntent, type TrackChoice } from './resume';
import { getResumeRewind } from './resumeRewind';
import { segmentsOf, type MarkerFields, type Segment } from './skip/segments';
import { stopTiming } from './stopTiming';
import { uuidV4 } from './uuid';

type S = components['schemas'];
export type Plan = S['PlaybackPlan'];
export type SelectedTracks = S['SelectedTracksV3'];
export type ReplanOperation = NonNullable<S['PlaybackReplanBody']['operation']>;

/** Progress is reported every 10 s while the session is open, playing or paused (protocol §2.5). */
export const PROGRESS_INTERVAL_MS = 10_000;
/** The recovery chain's bounds: `attempt_count` 1-8 and 16 remembered plan keys (§6). */
export const MAX_RECOVERIES = 8;
export const MAX_ATTEMPTED_KEYS = 16;
/** Lost connection (§6.2): retry after 1 s, doubling to a 15 s cap, for about two minutes. */
export const RECONNECT_FIRST_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const RECONNECT_BUDGET_MS = 120_000;
/** A session the server drops again and again is not worth another attempt. */
const MAX_RESTARTS = 3;
/** Waits before the retries of a stop that did not arrive (the stop_id stays the same). */
export const STOP_RETRY_DELAYS_MS = [500, 1_500];
/**
 * The stop goes out this long after the video was unloaded. webOS 26 hangs the next stream
 * request when the server aborts a stream the media stack still reads, and a stop that arrives
 * while the element is still loaded does exactly that. If the app closes within this time the
 * stop never goes out; the server's session lease ends the session then.
 */
export const STOP_AFTER_UNLOAD_MS = 2_000;
/**
 * A new source must deliver `loadedmetadata` within this time, or the load counts as failed.
 * webOS can hang a stream request without any event, which no media error would ever report.
 */
export const METADATA_TIMEOUT_MS = 20_000;
/** The largest position taken at its word: webOS reports INT64_MAX nanoseconds for "unknown". */
const MAX_PLAUSIBLE_SECONDS = 1e7;

/** What the player's overlay names: the title and, for an episode, its series and numbers. */
export interface Heading {
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export type SessionFailure = 'unsupported' | 'noFile' | 'terminal' | 'failed' | 'sessionEnded';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'prompt'; positionSeconds: number }
  | { kind: 'starting' }
  | {
      kind: 'ready';
      plan: Plan;
      sessionId: string;
      mediaUrl: string;
      /** Changes when the video has to load again; a new plan on the same stream keeps it. */
      loadId: number;
      /** False when the viewer had paused before a reload that should not start by itself. */
      autoplay: boolean;
      heading: Heading | null;
      previews: PreviewFacts;
      media: MediaFacts;
      /** The session's quality preference: `auto`, a resolution or a rung label. */
      quality: string;
      /** The server lists `plan_active_quality_v1`: the plan's `active_quality` can be trusted. */
      activeQualityFeature: boolean;
      /**
       * Counts the quality changes that could not play and went back to the quality before. The
       * screen shows its hint when this grows.
       */
      qualityFallbacks: number;
    }
  | {
      kind: 'error';
      reason: SessionFailure;
      message?: string;
      /** The server's terminal reason code, for a `terminal` failure that names one. */
      code?: string;
      plan?: Plan;
      sessionId?: string;
      mediaUrl?: string;
    };

/** What the overlay needs for the file that plays: its chapters and whether it has scrub previews. */
export interface PreviewFacts {
  /** The file the plan plays (the plan's effective file), which the previews are read for. */
  fileId: string;
  /** The server offers trickplay AND this file's version has it published. */
  trickplay: boolean;
  chapters: Chapter[];
  /** Intro, recap, credits and preview of the playing file, in source-time order. */
  segments: Segment[];
}

/**
 * What the options panel knows about the item and the version that plays: its tracks (typed from
 * the watch projection, so the Audio and Subtitles tabs can be built from them) and the facts the
 * Info tab names. Never a path or URL.
 */
export interface MediaFacts {
  /** The version the plan plays; the lists below are its own. */
  fileId: string;
  /** An episode (the "Auto-play next" row is for episodes only). */
  isEpisode: boolean;
  /** Owning series of an episode. */
  seriesId?: string;
  year?: number;
  videoCodec?: string;
  resolution?: string;
  hdr: boolean;
  /** The file's container as the library knows it (`mkv`, `mp4`). */
  container?: string;
  /** Bytes. */
  fileSize?: number;
  /** The file's overall bitrate in kbit/s, as the watch data gives it. */
  bitrateKbps?: number;
  /** How many versions (files) the title has. */
  versionCount?: number;
  /** The version's edition ("Director's Cut"), when it names one. */
  edition?: string;
  audioTracks: S['WatchAudioTrack'][];
  subtitleTracks: S['WatchSubtitleTrack'][];
}

/** What the player reports: the position on the source's timeline, in seconds. */
export interface PlayerReading {
  position: number;
  paused: boolean;
}

export interface MediaFailure {
  code: number;
  message: string;
}

class SessionError extends Error {
  constructor(readonly reason: SessionFailure) {
    super(reason);
  }
}

// The server's installation id, per server, for the whole app run. Every mutation carries it.
const installations = new Map<string, Installation>();

/** Test hook. */
export function clearInstallationCache(): void {
  installations.clear();
}

/** What the capabilities document tells about the server. */
interface Installation {
  id: string;
  trickplay: boolean;
  /** `marker_segments_v1`: the versions list every marker occurrence, not one per kind. */
  markerList: boolean;
  /** `plan_active_quality_v1`: plans name the quality entry they deliver. */
  activeQuality: boolean;
}

interface Version {
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
}

/** The item itself, from the watch projection. */
interface Item {
  isEpisode: boolean;
  seriesId?: string;
  year?: number;
}

interface Deps {
  client: SiloClient;
  baseUrl: string;
  session: Session;
  contentId: string;
  /** How to start; without one the player asks when there is something to resume. */
  intent?: StartIntent;
  /**
   * The profile's preferred quality, for a start whose intent names none. Resolves once the
   * profile's settings are settled (`auto` when they could not be read); without it, `auto`.
   */
  profileQuality?(): Promise<string>;
  onState(state: SessionState): void;
  onMediaError(failure: MediaFailure | null): void;
  /** The stream played to its end and the session is stopped. */
  onEnded(): void;
}

/** What a replan call may change besides the operation itself. */
export interface ReplanOptions {
  failure?: { classification: string; message?: string };
  /** Source seconds; default is where the player is. */
  position?: number;
  tracks?: SelectedTracks;
  quality?: string;
  /** Load the new plan's stream even when its URL is the one already loaded. */
  forceReload?: boolean;
  /** Whether the reloaded video starts by itself; default is the viewer's own play state. */
  autoplay?: boolean;
  /** A `quality_change` that goes back to the quality before one that did not play. */
  fallback?: boolean;
}

export type ReplanResult =
  | { kind: 'applied' }
  | { kind: 'terminal'; message?: string; reason?: string }
  /** The session is unknown to the server (404): a new attempt can pick up where it was. */
  | { kind: 'gone' }
  /** The server ended the session on purpose (410). */
  | { kind: 'ended' }
  /** Network failure, 5xx, 408, 429 or replan_in_progress: worth trying again. */
  | { kind: 'transient' }
  | { kind: 'refused' }
  /** Failure recovery ran out of attempts, or the server handed back a plan already tried. */
  | { kind: 'loop' }
  /** Nothing was sent: no plan yet, another replan is running, or the session is stopped. */
  | { kind: 'busy' };

/** A MediaError code: the media element could not reach its source. */
const MEDIA_ERR_NETWORK = 2;

function plausible(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_PLAUSIBLE_SECONDS;
}

function inRanges(ranges: { start: number; end: number }[], time: number): boolean {
  return ranges.some((range) => time >= range.start && time <= range.end);
}

function classifyRefusal(status: number, code: string): ReplanResult {
  if (status === 410) return { kind: 'ended' };
  if (status === 404 && code !== 'not_found') return { kind: 'gone' };
  if (status >= 500 || status === 408 || status === 429 || code === 'replan_in_progress') {
    return { kind: 'transient' };
  }
  return { kind: 'refused' };
}

/** A track pick as the start request carries it. */
interface Tracks {
  audio?: TrackChoice;
  subtitle?: TrackChoice;
}

function trackFields(tracks: Tracks) {
  return {
    ...(tracks.audio?.id !== undefined ? { audio_track_id: tracks.audio.id } : {}),
    ...(tracks.audio?.index !== undefined ? { audio_track_index: tracks.audio.index } : {}),
    ...(tracks.subtitle?.id !== undefined ? { subtitle_track_id: tracks.subtitle.id } : {}),
    ...(tracks.subtitle?.index !== undefined
      ? { subtitle_track_index: tracks.subtitle.index }
      : {}),
  };
}

export class PlaybackController {
  private disposed = false;
  private stopped = false;
  private profileId = '';
  private installationId = '';
  private fileId = '';
  /** The server lists `trickplay_v1` among its playback features. */
  private trickplayServer = false;
  /** The server lists `marker_segments_v1`. */
  private markerListServer = false;
  /** The server lists `plan_active_quality_v1`. */
  private activeQualityServer = false;
  private versions: Version[] = [];
  private item: Item = { isEpisode: false };
  private attemptId = '';
  private sessionId = '';
  private plan: Plan | null = null;
  private planAttemptId = '';
  private mediaUrl = '';
  private attemptedKeys: string[] = [];
  private capabilities: ClientCapabilities | null = null;
  private context: PlaybackContext | null = null;
  private startPosition = 0;
  private resumeAt: number | null = null;
  private heading: Heading | null = null;
  private sequence = 0;
  private loadId = 0;
  /** Failure recoveries in this attempt: the `attempt_count` of the loop guard. */
  private recoveries = 0;
  private restarts = 0;
  private replanning = false;
  private reconnecting = false;
  private restarting = false;
  /** The quality preference; null until a start decides it (the intent's, else the profile's). */
  private quality: string | null;
  private readonly pinnedFile: boolean;
  private tracks: Tracks;
  private read: (() => PlayerReading | null) | null = null;
  private engine: PlayerEngine | null = null;
  /** The container's own first timestamp: Chromium keeps it for Matroska. Set at loadedmetadata. */
  private origin = 0;
  private lastReading: PlayerReading | null = null;
  private playing = false;
  private wasPaused = false;
  private hasPlayed = false;
  /** What the viewer wants: a reload after a lost connection or session follows it. */
  private viewerPaused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The first-frame watchdog; running only while a loaded source has not shown its metadata. */
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private awaitingMetadata = false;
  /** The load whose failure was handled already: one failure is recovered once. */
  private failedLoad = -1;
  /**
   * The load a viewer's quality change started, with the preference from before it. While it has
   * not shown its first frame, a failure goes back to that preference instead of recovering.
   */
  private qualityLoad: { loadId: number; previous: string } | null = null;
  /** Fallbacks to the previous quality so far (see `SessionState.qualityFallbacks`). */
  private qualityFallbacks = 0;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: Deps) {
    this.quality = deps.intent?.quality ?? null;
    this.pinnedFile = deps.intent?.fileId !== undefined;
    this.tracks = { audio: deps.intent?.audio, subtitle: deps.intent?.subtitle };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private header() {
    return { 'X-Profile-Id': this.profileId };
  }

  private set(state: SessionState): void {
    if (!this.disposed) this.deps.onState(state);
  }

  private fail(reason: SessionFailure, message?: string, code?: string): void {
    // An errored session is not worth a heartbeat.
    this.clearTimer();
    this.disarmWatchdog();
    this.set({
      kind: 'error',
      reason,
      ...(message ? { message } : {}),
      ...(code ? { code } : {}),
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.mediaUrl ? { mediaUrl: this.mediaUrl } : {}),
    });
  }

  // --- Preparation ---------------------------------------------------------------------------

  /** Capabilities and the watch state; then either the resume prompt or the start. */
  async begin(): Promise<void> {
    const profileId = this.deps.session.get()?.profileId;
    if (!profileId) {
      this.fail('failed');
      return;
    }
    this.profileId = profileId;
    try {
      const [installationId, watch] = await Promise.all([this.installation(), this.watch()]);
      if (this.disposed) return;
      this.installationId = installationId.id;
      this.trickplayServer = installationId.trickplay;
      this.markerListServer = installationId.markerList;
      this.activeQualityServer = installationId.activeQuality;
      this.versions = watch.versions;
      this.item = watch.item;
      this.fileId = watch.fileId;
      this.resumeAt = watch.resume;
      this.heading = watch.heading;
      const kind = this.deps.intent?.kind ?? 'ask';
      if (kind === 'beginning') {
        await this.start(0);
      } else if (kind === 'resume') {
        await this.resume();
      } else if (watch.resume !== null) {
        this.set({ kind: 'prompt', positionSeconds: watch.resume });
      } else {
        await this.start(0);
      }
    } catch (error) {
      this.fail(error instanceof SessionError ? error.reason : 'failed');
    }
  }

  private async installation(): Promise<Installation> {
    const cached = installations.get(this.deps.baseUrl);
    if (cached) return cached;
    const { data, response } = await this.deps.client.GET('/api/v2/playback/capabilities', {
      params: { header: this.header() },
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
    installations.set(this.deps.baseUrl, known);
    return known;
  }

  private async watch(): Promise<{
    fileId: string;
    resume: number | null;
    heading: Heading;
    versions: Version[];
    item: Item;
  }> {
    const { data, error, response } = await this.deps.client.GET('/api/v2/watch/{id}', {
      params: { path: { id: this.deps.contentId }, header: this.header() },
    });
    if (!data) throw toApiError(error, response);
    // The file the viewer picked, else the one watched last, else the first.
    const wanted = this.deps.intent?.fileId ?? data.user_data?.last_file_id;
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
    }));
    const item: Item = {
      isEpisode: data.type === 'episode',
      ...(data.series_id ? { seriesId: data.series_id } : {}),
      ...(data.year !== undefined ? { year: data.year } : {}),
    };
    return { fileId: version.file_id, resume, heading, versions, item };
  }

  // --- Start ---------------------------------------------------------------------------------

  /**
   * Starts at the resume point, moved back by the "Rewind on resume" setting (read now, so a
   * change applies to the next start); from the beginning when there is no resume point.
   */
  async resume(): Promise<void> {
    await this.start(this.resumeAt === null ? 0 : rewound(this.resumeAt, getResumeRewind()));
  }

  /** Starts the playback at `position` seconds (0 means from the beginning). */
  async start(position: number, retryInstallation = true): Promise<void> {
    this.set({ kind: 'starting' });
    this.startPosition = position;
    try {
      // The first start decides the quality: the intent's, else what the profile prefers (the
      // server does not apply that setting itself). Later starts keep what the viewer picked.
      this.quality ??= (await this.deps.profileQuality?.()) ?? 'auto';
      if (this.disposed) return;
      const probe = await collectProfileProbe();
      this.capabilities = buildClientCapabilities(probe);
      this.context = buildPlaybackContext(probe);
      this.attemptId = uuidV4();
      const { data, error, response } = await this.deps.client.POST('/api/v2/playback/start', {
        params: { header: this.header() },
        body: {
          installation_id: this.installationId,
          protocol_version: 3,
          client_features: CLIENT_FEATURES,
          file_id: this.fileId,
          // A file the viewer picked is the one to play, not one of its alternate versions.
          ...(this.pinnedFile ? { allow_alternate_versions: false } : {}),
          profile_id: this.profileId,
          playback_attempt_id: this.attemptId,
          quality_preference: this.quality,
          subtitle_fidelity_preference: 'compatible',
          start_position: position,
          // Left out unless the viewer picked one: then the server decides from the preferences.
          ...trackFields(this.tracks),
          client_capabilities: this.capabilities,
          client_playback_context: this.context,
        },
      });
      if (this.disposed) {
        // Left while the start was in flight: end the session the server just created.
        this.unload();
        if (data?.session_id) await this.stopSession(data.session_id);
        return;
      }
      if (!data) {
        const problem = toApiError(error, response);
        if (problem.code === 'installation_changed' && retryInstallation) {
          // The server was replaced or restored: read its capabilities again, new attempt.
          installations.delete(this.deps.baseUrl);
          const refreshed = await this.installation();
          this.installationId = refreshed.id;
          this.trickplayServer = refreshed.trickplay;
          this.markerListServer = refreshed.markerList;
          this.activeQualityServer = refreshed.activeQuality;
          await this.start(position, false);
          return;
        }
        this.fail(response.status === 426 ? 'unsupported' : 'failed');
        return;
      }
      const sessionId = data.session_id ?? data.playback_plan?.session_id;
      if (data.outcome === 'playable' && data.playback_plan && sessionId) {
        this.adopt(data.playback_plan, sessionId);
      } else {
        this.fail('terminal', data.terminal?.message, data.terminal?.reason);
      }
    } catch (error) {
      this.fail(error instanceof SessionError ? error.reason : 'failed');
    }
  }

  /**
   * Takes a plan as the current one. The video loads again only when the stream is another one
   * (a new URL or timeline) or the old transport is dead; a plan on the same stream plays on.
   */
  private adopt(
    plan: Plan,
    sessionId: string,
    options: { forceReload?: boolean; autoplay?: boolean } = {},
  ): void {
    const previous = this.plan;
    const url = mediaUrlWithToken(
      plan.stream.url,
      this.deps.baseUrl,
      this.deps.session.get()?.accessToken,
    );
    const reload =
      !previous ||
      Boolean(options.forceReload) ||
      sessionId !== this.sessionId ||
      url !== this.mediaUrl ||
      previous.timeline.timeline_offset_seconds !== plan.timeline.timeline_offset_seconds ||
      previous.timeline.stream_origin_seconds !== plan.timeline.stream_origin_seconds;
    this.plan = plan;
    this.sessionId = sessionId;
    this.planAttemptId = uuidV4();
    if (!this.attemptedKeys.includes(plan.plan_attempt_key)) {
      this.attemptedKeys.push(plan.plan_attempt_key);
    }
    this.attemptedKeys = this.attemptedKeys.slice(-MAX_ATTEMPTED_KEYS);
    this.mediaUrl = url;
    if (reload) {
      this.loadId += 1;
      this.playing = false;
      this.wasPaused = false;
      // A new load must prove itself again before progress counts, and finds its own origin.
      this.hasPlayed = false;
      this.origin = 0;
      // The old element is replaced; the new one arms the watchdog when it is attached.
      this.disarmWatchdog();
    }
    this.set({
      kind: 'ready',
      plan,
      sessionId,
      mediaUrl: url,
      loadId: this.loadId,
      autoplay: options.autoplay ?? !this.viewerPaused,
      heading: this.heading,
      previews: this.previewFacts(plan),
      media: this.mediaFacts(plan),
      quality: this.quality ?? 'auto',
      activeQualityFeature: this.activeQualityServer,
      qualityFallbacks: this.qualityFallbacks,
    });
  }

  /** The item and the played version's facts for the options panel. */
  private mediaFacts(plan: Plan): MediaFacts {
    const fileId = plan.effective_media_file_id;
    const version = this.versions.find((v) => v.fileId === fileId);
    return {
      fileId,
      isEpisode: this.item.isEpisode,
      ...(this.item.seriesId ? { seriesId: this.item.seriesId } : {}),
      ...(this.item.year !== undefined ? { year: this.item.year } : {}),
      ...(version?.videoCodec ? { videoCodec: version.videoCodec } : {}),
      ...(version?.resolution ? { resolution: version.resolution } : {}),
      hdr: version?.hdr === true,
      ...(version?.container ? { container: version.container } : {}),
      ...(version?.fileSize ? { fileSize: version.fileSize } : {}),
      ...(version?.bitrateKbps ? { bitrateKbps: version.bitrateKbps } : {}),
      versionCount: this.versions.length,
      ...(version?.edition ? { edition: version.edition } : {}),
      audioTracks: version?.audioTracks ?? [],
      subtitleTracks: version?.subtitleTracks ?? [],
    };
  }

  /** Chapters, previews and skippable segments of the file the plan plays (an alternate version may differ from the picked one). */
  private previewFacts(plan: Plan): PreviewFacts {
    const fileId = plan.effective_media_file_id;
    // Only the exact file: another version's chapters and previews would not match its timeline.
    const version = this.versions.find((v) => v.fileId === fileId);
    return {
      fileId,
      trickplay: this.trickplayServer && version?.trickplay === true,
      chapters: version?.chapters ?? [],
      segments: version ? segmentsOf(version.markers, this.markerListServer) : [],
    };
  }

  // --- Player ---------------------------------------------------------------------------------

  /** Overrides how the position is read; the engine is the normal source. */
  bindPlayer(read: (() => PlayerReading | null) | null): void {
    this.read = read;
  }

  /** The screen hands over the engine of its video; null when the video goes away. */
  attachEngine(engine: PlayerEngine | null): void {
    // The last position must be taken while the engine can still tell it.
    if (!engine) this.reading();
    this.engine = engine;
    // A new element loads a new source (every load mounts its own); a gone one loads nothing.
    this.awaitingMetadata = engine !== null && !this.stopped;
    this.armWatchdog();
  }

  /** Unloads the video: the decoder is freed and the element has no source. Safe to repeat. */
  private unload(): void {
    const engine = this.engine;
    this.engine = null;
    engine?.release();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    if (!this.awaitingMetadata || this.stopped || document.visibilityState === 'hidden') return;
    this.watchdog = setTimeout(this.onWatchdog, METADATA_TIMEOUT_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private disarmWatchdog(): void {
    this.awaitingMetadata = false;
    this.clearWatchdog();
  }

  /** No metadata and no error in time: the load failed silently, so it takes the failure path. */
  private readonly onWatchdog = (): void => {
    this.watchdog = null;
    const engine = this.engine;
    if (!engine || !this.awaitingMetadata || this.stopped) return;
    this.awaitingMetadata = false;
    // Data without metadata is a decoder's problem; nothing at all is a transport that stalled.
    const received = engine.buffered.length > 0;
    // Always a failure recovery: a silent hang is a failed route, never a lost connection, so
    // the server must pick another one instead of the same URL being retried.
    void this.onMediaError(
      {
        code: received ? 3 : MEDIA_ERR_NETWORK,
        message: `No metadata within ${METADATA_TIMEOUT_MS / 1000} s`,
      },
      received ? 'decoder_failure' : 'transport_stall',
    );
  };

  /** The position on the source's timeline: player time minus the container origin plus the offset. */
  reading(): PlayerReading | null {
    const raw = this.read?.() ?? this.readEngine();
    // An implausible time (webOS reports INT64_MAX nanoseconds for "unknown") is no position.
    if (raw && !plausible(raw.position)) {
      return this.lastReading ?? { position: this.startPosition, paused: raw.paused };
    }
    // Until a frame has played the element is at its own 0: the plan's start is the position.
    const live = raw && !this.hasPlayed ? { ...raw, position: this.startPosition } : raw;
    if (live) this.lastReading = live;
    return live ?? this.lastReading;
  }

  private readEngine(): PlayerReading | null {
    const engine = this.engine;
    if (!engine) return null;
    const offset = this.plan?.timeline.timeline_offset_seconds ?? 0;
    return {
      // NaN for a time that cannot be one, which reading() turns into the last good position.
      position: plausible(engine.currentTime)
        ? Math.max(0, engine.currentTime - this.origin) + offset
        : Number.NaN,
      paused: engine.paused,
    };
  }

  /** The container's first timestamp is the origin; then the player moves to the plan's start. */
  onLoadedMetadata(): void {
    const engine = this.engine;
    const plan = this.plan;
    this.disarmWatchdog();
    if (!engine || !plan) return;
    this.origin = plausible(engine.currentTime) ? engine.currentTime : 0;
    const start = plan.timeline.player_start_seconds;
    if (start > 0) engine.seek(this.origin + start);
  }

  onPlaying(): void {
    if (this.stopped) return;
    this.hasPlayed = true;
    this.playing = true;
    this.viewerPaused = false;
    if (this.wasPaused) {
      this.wasPaused = false;
      this.sendProgress(false);
    }
    // The heartbeat runs while playing and while paused: the server drops a quiet session.
    this.timer ??= setInterval(() => {
      if (this.hasPlayed) this.sendProgress(!this.playing);
    }, PROGRESS_INTERVAL_MS);
  }

  onPause(): void {
    // The element's own pause event follows a pause made here: report once.
    if (this.stopped || this.wasPaused) return;
    this.playing = false;
    this.wasPaused = true;
    this.viewerPaused = true;
    this.sendProgress(true);
  }

  /** The stream played to its end: stop with the end position, then hand over. */
  onEnded(): void {
    if (this.stopped) return;
    void this.stop();
    if (!this.disposed) this.deps.onEnded();
  }

  /** A hidden document (the viewer left the app) pauses and reports at once. */
  private readonly onVisibility = (): void => {
    // The watchdog does not run while the page is hidden; it starts over when it is shown again.
    if (document.visibilityState === 'hidden') this.clearWatchdog();
    else this.armWatchdog();
    if (document.visibilityState !== 'hidden' || this.stopped) return;
    const engine = this.engine;
    if (!engine || engine.paused) return;
    engine.pause();
    this.onPause();
  };

  private sendProgress(paused: boolean): void {
    if (this.stopped || !this.sessionId) return;
    const reading = this.reading();
    if (!reading) return;
    this.sequence += 1;
    const sessionId = this.sessionId;
    this.deps.client
      .POST('/api/v2/playback/{session_id}/progress', {
        params: { path: { session_id: sessionId }, header: this.header() },
        body: {
          installation_id: this.installationId,
          sequence: this.sequence,
          position: reading.position,
          is_paused: paused,
        },
      })
      .then(
        ({ error, response }) => {
          // The answer of a session that was replaced meanwhile says nothing about this one.
          if (sessionId !== this.sessionId) return;
          // An administratively ended session (410) must not be restarted ...
          if (response.status === 410) this.sessionGone();
          // ... an expired one (404) is, where the viewer was (stale_sample and replayed are fine).
          else if (response.status === 404 && toApiError(error, response).code !== 'not_found') {
            void this.restartAt(reading.position);
          }
        },
        () => undefined,
      );
  }

  private sessionGone(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.cancelWait();
    this.fail('sessionEnded');
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves after `ms`, or early when the session ends. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle = setTimeout(done, ms);
      function done() {
        clearTimeout(handle);
        resolve();
      }
      this.wake = done;
    });
  }

  private cancelWait(): void {
    this.wake?.();
    this.wake = null;
  }

  // --- Seeking --------------------------------------------------------------------------------

  /**
   * Moves to a position on the source's timeline. The player seeks by itself where the plan lets
   * it (it can seek anywhere, or the target is in the seekable range); otherwise the server moves
   * the timeline (a seek_reanchor replan) and the new plan loads at the position.
   */
  async seekTo(sourceSeconds: number): Promise<void> {
    const plan = this.plan;
    const engine = this.engine;
    if (!plan || !engine || this.stopped) return;
    if (this.replanning || this.reconnecting || this.restarting) return;
    const offset = plan.timeline.timeline_offset_seconds;
    const total = plan.source.duration_seconds;
    const wanted = this.origin + sourceSeconds - offset;
    // Never past the ends: the engine's duration, else the source's own runtime.
    const end = Number.isFinite(engine.duration)
      ? engine.duration
      : total !== undefined
        ? this.origin + total - offset
        : Infinity;
    if (plan.timeline.can_seek_anywhere) {
      engine.seek(Math.min(end, Math.max(this.origin, wanted)));
      return;
    }
    if (inRanges(engine.seekable, wanted)) {
      engine.seek(wanted);
      return;
    }
    const position = Math.max(0, Math.min(total ?? Infinity, sourceSeconds));
    await this.settle(await this.replan('seek_reanchor', { position }), position);
  }

  /** What a replan the viewer asked for (not a failure) leaves to do. */
  private async settle(result: ReplanResult, position: number): Promise<void> {
    if (result.kind === 'terminal') this.fail('terminal', result.message, result.reason);
    else if (result.kind === 'ended') this.sessionGone();
    else if (result.kind === 'gone') await this.restartAt(position);
    // transient, refused and busy: the current plan keeps playing and the request is dropped.
  }

  /** Switches the audio and subtitle (an omitted subtitle means off); no UI calls this yet. */
  async trackChange(selected: SelectedTracks): Promise<ReplanResult> {
    const result = await this.replan('track_change', { tracks: selected });
    await this.settle(result, this.reading()?.position ?? this.startPosition);
    return result;
  }

  /** Switches to a quality label from the plan's `available_qualities` (or `auto`). */
  async qualityChange(label: string): Promise<ReplanResult> {
    const result = await this.replan('quality_change', { quality: label });
    await this.settle(result, this.reading()?.position ?? this.startPosition);
    return result;
  }

  // --- Replan ----------------------------------------------------------------------------------

  /**
   * Any replan operation of the protocol, with a fresh request id each time. Failure recoveries
   * count against the loop guard (`attempt_count` up to 8, the last 16 attempted plan keys), and a
   * plan they bring back that was already tried is a loop. A track, quality or seek replan may
   * bring a known plan back: that is not a loop. The result tells what happened; the caller
   * decides what it means for the screen.
   */
  async replan(operation: ReplanOperation, options: ReplanOptions = {}): Promise<ReplanResult> {
    const plan = this.plan;
    const capabilities = this.capabilities;
    const context = this.context;
    if (this.stopped || this.replanning || !plan || !capabilities || !context) {
      return { kind: 'busy' };
    }
    const recovery = operation === 'failure_recovery' || operation === 'seek_failure_recovery';
    if (recovery && this.recoveries >= MAX_RECOVERIES) return { kind: 'loop' };
    this.replanning = true;
    try {
      let profile = { capabilities, context };
      if (operation === 'output_change') profile = await this.refreshProfile();
      if (recovery) this.recoveries += 1;
      const reading = this.hasPlayed ? this.reading() : null;
      const position = options.position ?? reading?.position ?? this.startPosition;
      const { data, error, response } = await this.deps.client.POST(
        '/api/v2/playback/{session_id}/replan',
        {
          params: { path: { session_id: this.sessionId }, header: this.header() },
          body: {
            installation_id: this.installationId,
            protocol_version: 3,
            operation,
            ...(options.failure ? { failure: options.failure } : {}),
            client_features: CLIENT_FEATURES,
            playback_attempt_id: this.attemptId,
            replan_request_id: uuidV4(),
            failed_plan_id: plan.plan_id,
            plan_attempt_id: this.planAttemptId,
            plan_attempt_key: plan.plan_attempt_key,
            attempted_plan_keys: this.attemptedKeys,
            attempt_count: Math.max(1, this.recoveries),
            quality_preference: options.quality ?? this.quality ?? 'auto',
            position_seconds: position,
            selected_tracks: options.tracks ?? plan.selected_tracks,
            client_capabilities: profile.capabilities,
            client_playback_context: profile.context,
          },
        },
      );
      if (this.stopped) return { kind: 'busy' };
      if (!data) {
        const problem = toApiError(error, response);
        return classifyRefusal(problem.status, problem.code);
      }
      const sessionId = data.session_id ?? data.playback_plan?.session_id ?? this.sessionId;
      if (data.outcome === 'playable' && data.playback_plan) {
        const next = data.playback_plan;
        if (recovery && this.attemptedKeys.includes(next.plan_attempt_key)) {
          return { kind: 'loop' };
        }
        // The new load starts here; until its first frame this is the position to report.
        this.startPosition = position;
        // The viewer's pick is the preference from the plan on, so the state that comes with
        // the new plan already carries it.
        const before = this.quality ?? 'auto';
        const qualityPick = operation === 'quality_change' && options.quality !== undefined;
        if (qualityPick) this.quality = options.quality ?? before;
        if (qualityPick && options.fallback) this.qualityFallbacks += 1;
        const loadBefore = this.loadId;
        // After a failure the old transport is dead, so its URL is no reason to keep it.
        this.adopt(next, sessionId, {
          forceReload: options.forceReload || recovery,
          autoplay: options.autoplay,
        });
        // A new load from the viewer's pick may fail before its first frame: then the way back is
        // the quality it came from. The way back itself has no way back.
        this.qualityLoad =
          qualityPick && !options.fallback && this.loadId !== loadBefore
            ? { loadId: this.loadId, previous: before }
            : null;
        return { kind: 'applied' };
      }
      return { kind: 'terminal', message: data.terminal?.message, reason: data.terminal?.reason };
    } catch {
      return this.stopped ? { kind: 'busy' } : { kind: 'transient' };
    } finally {
      this.replanning = false;
    }
  }

  /** The display or output changed: the device profile is read again and kept. */
  private async refreshProfile(): Promise<{
    capabilities: ClientCapabilities;
    context: PlaybackContext;
  }> {
    const probe = await collectProfileProbe();
    this.capabilities = buildClientCapabilities(probe);
    this.context = buildPlaybackContext(probe);
    return { capabilities: this.capabilities, context: this.context };
  }

  /** A MediaError: a lost connection reconnects; any other failure replans for another route. */
  async onMediaError(failure: MediaFailure, classification?: string): Promise<void> {
    // Whatever the error is, the load has an answer now and the watchdog has nothing to add.
    this.disarmWatchdog();
    if (this.stopped || this.replanning || this.reconnecting || this.restarting) return;
    if (!this.plan || !this.capabilities || !this.context) return;
    // A second report of the same load (an error after the watchdog fired) is not a new failure.
    if (this.failedLoad === this.loadId) return;
    this.failedLoad = this.loadId;
    this.deps.onMediaError(failure);
    this.playing = false;
    // A quality the viewer picked that does not play before its first frame goes back to the
    // quality before it, at the same position. If that is not possible, the failure path below runs.
    const pick = this.qualityLoad;
    this.qualityLoad = null;
    if (pick && pick.loadId === this.loadId && !this.hasPlayed) {
      const back = await this.replan('quality_change', {
        quality: pick.previous,
        position: this.reading()?.position ?? this.startPosition,
        forceReload: true,
        fallback: true,
      });
      if (back.kind === 'applied' || this.stopped) return;
    }
    // A network error after the first frame is a lost connection, not a failed route (§6.2).
    // A caller that names the classification (the watchdog) has decided it is a route failure.
    if (failure.code === MEDIA_ERR_NETWORK && this.hasPlayed && !classification) {
      await this.reconnect();
      return;
    }
    const result = await this.replan('failure_recovery', {
      // The values the existing clients send: a decode or unsupported-source failure is a
      // decoder failure; an aborted or interrupted load is a transport stall.
      failure: {
        classification:
          classification ??
          (failure.code === 3 || failure.code === 4 ? 'decoder_failure' : 'transport_stall'),
        message: failure.message.slice(0, 512),
      },
    });
    switch (result.kind) {
      case 'applied':
      case 'busy':
        return;
      case 'terminal':
        this.fail('terminal', result.message, result.reason);
        return;
      case 'ended':
        this.sessionGone();
        return;
      case 'gone':
        await this.restartAt(this.reading()?.position ?? this.startPosition);
        return;
      case 'transient':
        // The recovery could not reach the server: it joins the reconnect.
        await this.reconnect();
        return;
      default:
        this.fail('failed');
    }
  }

  // --- Lost connection (§6.2) ---------------------------------------------------------------------

  /**
   * The route did not fail, the connection did: retry an unchanged track_change at the saved
   * position, 1 s doubling to 15 s, for about two minutes. A session the server no longer knows
   * starts anew at that position. The budget running out is a failure as before.
   */
  private async reconnect(): Promise<void> {
    const plan = this.plan;
    if (this.reconnecting || !plan) return;
    this.reconnecting = true;
    const saved = this.reading()?.position ?? this.startPosition;
    const play = !this.viewerPaused;
    // A paused report is the longest grace the server gives a quiet session (§2.5).
    this.sendProgress(true);
    let restart = false;
    try {
      let delay = RECONNECT_FIRST_DELAY_MS;
      let waited = 0;
      for (;;) {
        await this.wait(delay);
        if (this.stopped) return;
        waited += delay;
        const result = await this.replan('track_change', {
          position: saved,
          tracks: plan.selected_tracks,
          forceReload: true,
          autoplay: play,
        });
        if (this.stopped) return;
        if (result.kind === 'applied' || result.kind === 'busy') return;
        if (result.kind === 'terminal') {
          this.fail('terminal', result.message, result.reason);
          return;
        }
        if (result.kind === 'ended') {
          this.sessionGone();
          return;
        }
        if (result.kind !== 'transient') {
          // Anything but a retryable answer means the session did not survive.
          restart = true;
          return;
        }
        if (waited >= RECONNECT_BUDGET_MS) {
          this.fail('failed');
          return;
        }
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    } finally {
      this.reconnecting = false;
      if (restart) await this.restartAt(saved);
    }
  }

  /** The session is gone on the server: a new attempt at `position`, with the tracks playing now. */
  private async restartAt(position: number): Promise<void> {
    if (this.stopped || this.restarting) return;
    if (this.restarts >= MAX_RESTARTS) {
      this.sessionGone();
      return;
    }
    this.restarts += 1;
    this.restarting = true;
    try {
      if (this.plan) {
        this.tracks = {
          audio: this.plan.selected_tracks.audio,
          subtitle: this.plan.selected_tracks.subtitle,
        };
      }
      // Nothing to stop on the server any more; the new session counts from its own start.
      this.sessionId = '';
      this.sequence = 0;
      this.attemptedKeys = [];
      this.recoveries = 0;
      this.plan = null;
      this.hasPlayed = false;
      await this.start(position);
    } finally {
      this.restarting = false;
    }
  }

  // --- Stop ----------------------------------------------------------------------------------

  /** Ends the session on the server with the final position. Safe to call more than once. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.clearTimer();
    this.cancelWait();
    this.disarmWatchdog();
    // The final reading first, then the unload, then (later) the stop: see STOP_AFTER_UNLOAD_MS.
    const reading = this.sessionId ? this.reading() : null;
    this.unload();
    if (!this.sessionId) return Promise.resolve();
    return this.stopSession(this.sessionId, reading);
  }

  private async stopSession(sessionId: string, reading?: PlayerReading | null): Promise<void> {
    // One body for every try: a retry is the same stop (same stop_id, same final sample).
    const body = {
      installation_id: this.installationId,
      stop_id: uuidV4(),
      // The final sample: sequence and position go together or not at all.
      ...(reading
        ? {
            sequence: (this.sequence += 1),
            position: reading.position,
            is_paused: reading.paused,
          }
        : {}),
    };
    await new Promise<void>((resolve) => {
      stopTiming.waiting += 1;
      setTimeout(() => {
        stopTiming.waiting -= 1;
        resolve();
      }, stopTiming.delayMs ?? STOP_AFTER_UNLOAD_MS);
    });
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { response } = await this.deps.client.DELETE('/api/v2/playback/{session_id}', {
          params: { path: { session_id: sessionId }, header: this.header() },
          body,
        });
        const status = response.status;
        // 404: the session had already ended. Other 4xx: retrying cannot change the answer.
        if (status < 500 && status !== 408 && status !== 429) return;
      } catch {
        // No answer: try again below.
      }
      const delay = STOP_RETRY_DELAYS_MS[attempt];
      // Out of retries: the server ends an abandoned session on its own after a timeout.
      if (delay === undefined) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /** The screen is gone: end the session, and one still being started when it arrives. */
  dispose(): void {
    void this.stop();
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

export interface ProfileQuality {
  known: boolean;
  quality: string;
}

const AUTO_PROFILE: ProfileQuality = { known: true, quality: 'auto' };

export interface PlaybackSession {
  state: SessionState;
  mediaError: MediaFailure | null;
  /** From the resume prompt: start over (`0`) or at another position, as given. */
  choose(position: number): void;
  /** From the resume prompt: continue at the resume point, rewound. */
  resume(): void;
  bindPlayer(read: (() => PlayerReading | null) | null): void;
  attachEngine(engine: PlayerEngine | null): void;
  /** The position on the source's timeline, for the screen's own display. */
  reading(): PlayerReading | null;
  onLoadedMetadata(): void;
  onPlaying(): void;
  onPause(): void;
  onEnded(): void;
  onMediaError(failure: MediaFailure): void;
  seekTo(sourceSeconds: number): Promise<void>;
  trackChange(selected: SelectedTracks): Promise<ReplanResult>;
  qualityChange(label: string): Promise<ReplanResult>;
  stop(): Promise<void>;
}

/**
 * `onEnded` runs when the stream played to its end and the session is stopped; the screen decides
 * what follows (leave, later the Up Next card).
 */
export function usePlaybackSession(
  contentId: string,
  intent?: StartIntent,
  onEnded?: () => void,
  /** The profile's preferred quality and whether its settings are settled; default `auto`, settled. */
  profile: ProfileQuality = AUTO_PROFILE,
): PlaybackSession {
  const { client, baseUrl, session } = useSilo();
  const [state, setState] = useState<SessionState>({ kind: 'loading' });
  const [mediaError, setMediaError] = useState<MediaFailure | null>(null);
  const controller = useRef<PlaybackController | null>(null);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);
  // A start waits here until the profile's settings are settled; a settled answer never waits.
  const profileRef = useRef({ profile, waiters: [] as ((quality: string) => void)[] });
  useEffect(() => {
    const entry = profileRef.current;
    entry.profile = profile;
    if (profile.known) entry.waiters.splice(0).forEach((resolve) => resolve(profile.quality));
  }, [profile]);
  const profileQuality = useCallback(
    () =>
      profileRef.current.profile.known
        ? Promise.resolve(profileRef.current.profile.quality)
        : new Promise<string>((resolve) => profileRef.current.waiters.push(resolve)),
    [],
  );

  useEffect(() => {
    const created = new PlaybackController({
      client,
      baseUrl,
      session,
      contentId,
      intent,
      profileQuality,
      onState: setState,
      onMediaError: setMediaError,
      onEnded: () => ended.current?.(),
    });
    controller.current = created;
    void created.begin();
    return () => {
      created.dispose();
      controller.current = null;
    };
    // The intent is a plain value: its kind restarts the session, a new object of the same kind must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, baseUrl, session, contentId, intent?.kind, profileQuality]);

  const choose = useCallback((position: number) => void controller.current?.start(position), []);
  const resume = useCallback(() => void controller.current?.resume(), []);
  const bindPlayer = useCallback(
    (read: (() => PlayerReading | null) | null) => controller.current?.bindPlayer(read),
    [],
  );
  const attachEngine = useCallback(
    (engine: PlayerEngine | null) => controller.current?.attachEngine(engine),
    [],
  );
  const reading = useCallback(() => controller.current?.reading() ?? null, []);
  const onLoadedMetadata = useCallback(() => controller.current?.onLoadedMetadata(), []);
  const onPlaying = useCallback(() => controller.current?.onPlaying(), []);
  const onPause = useCallback(() => controller.current?.onPause(), []);
  const onEnd = useCallback(() => controller.current?.onEnded(), []);
  const onMediaError = useCallback(
    (failure: MediaFailure) => void controller.current?.onMediaError(failure),
    [],
  );
  const seekTo = useCallback(
    (sourceSeconds: number) => controller.current?.seekTo(sourceSeconds) ?? Promise.resolve(),
    [],
  );
  const trackChange = useCallback(
    (selected: SelectedTracks) =>
      controller.current?.trackChange(selected) ?? Promise.resolve<ReplanResult>({ kind: 'busy' }),
    [],
  );
  const qualityChange = useCallback(
    (label: string) =>
      controller.current?.qualityChange(label) ?? Promise.resolve<ReplanResult>({ kind: 'busy' }),
    [],
  );
  const stop = useCallback(() => controller.current?.stop() ?? Promise.resolve(), []);

  return useMemo(
    () => ({
      state,
      mediaError,
      choose,
      resume,
      bindPlayer,
      attachEngine,
      reading,
      onLoadedMetadata,
      onPlaying,
      onPause,
      onEnded: onEnd,
      onMediaError,
      seekTo,
      trackChange,
      qualityChange,
      stop,
    }),
    [
      state,
      mediaError,
      choose,
      resume,
      bindPlayer,
      attachEngine,
      reading,
      onLoadedMetadata,
      onPlaying,
      onPause,
      onEnd,
      onMediaError,
      seekTo,
      trackChange,
      qualityChange,
      stop,
    ],
  );
}
