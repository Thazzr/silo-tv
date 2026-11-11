// One playback through Silo playback protocol v3: capabilities, start, progress, replans (failure
// recovery, reconnect, seek, track and quality changes) and stop. The controller is plain
// TypeScript so the protocol logic does not depend on React; usePlaybackSession ties its lifetime
// to a component. It drives the player only through the PlayerEngine interface.
//
// It holds the session's state and wires the modules next to it: startSession (before a plan
// plays), ProgressReporter, Replanner, Recovery with the first-frame watchdog, StopSequence.
import type { SiloClient } from '../../api/client';
import type { Session } from '../../api/session';
import type { ClientCapabilities, PlaybackContext } from '../deviceProfile';
import { isHlsStream, type PlayerEngine } from '../engine/PlayerEngine';
import { mediaUrlWithToken } from '../mediaUrl';
import { rewound, type StartIntent } from '../resume';
import { getResumeRewind } from '../resumeRewind';
import {
  playingAudioLanguage,
  resolveSubtitle,
  subtitleSettings,
  type InventoryItem,
  type SubtitleDefaults,
  type SubtitleSettings,
  type SubtitleWatchFields,
} from '../subtitleAuto';
import { uuidV4 } from '../uuid';
import type { BufferingMode } from './bufferingQuality';
import { BufferingManager, type BufferingAnswer, type BufferingView } from './BufferingManager';
import { mediaFacts, plausible, previewFacts, type Item, type Tracks, type Version } from './facts';
import { ProgressReporter } from './ProgressReporter';
import { FirstFrameWatchdog, Recovery } from './recovery';
import { Replanner } from './replan';
import { StopSequence } from './StopSequence';
import {
  forgetInstallation,
  interpretStart,
  loadInstallation,
  loadWatch,
  readDeviceProfile,
  requestStart,
  type Installation,
} from './startSession';
import {
  SessionError,
  type Heading,
  type MediaFailure,
  type Plan,
  type PlayerReading,
  type ReplanOperation,
  type ReplanOptions,
  type ReplanResult,
  type SelectedTracks,
  type SessionFailure,
  type SessionState,
} from './types';

/** The recovery chain remembers this many plan keys (§6). */
export const MAX_ATTEMPTED_KEYS = 16;

export interface ControllerDeps {
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
  /**
   * The profile's subtitle settings, for a title whose watch data stores none; resolves once the
   * profile's settings are settled. Without it, the contract defaults.
   */
  subtitleDefaults?(): Promise<SubtitleDefaults>;
  /** The profile's bitrate cap in kbit/s, read at every start and replan; null or absent = none. */
  bandwidthCap?(): number | null;
  /**
   * The profile's buffering-quality mode and whether the server's settings know it, read anew each
   * time; without it `always`, unknown (no buffering fields are sent).
   */
  buffering?(): { feature: boolean; mode: BufferingMode };
  /** What the buffering controller offers the screen: the prompt, the undo pill, the notices. */
  onBuffering?(view: BufferingView): void;
  onState(state: SessionState): void;
  onMediaError(failure: MediaFailure | null): void;
  /** The stream played to its end and the session is stopped. */
  onEnded(): void;
}

export class PlaybackController {
  private disposed = false;
  private stopped = false;
  private profileId = '';
  /** What the server's capabilities say; empty until the first begin. */
  private server: Installation = {
    id: '',
    trickplay: false,
    markerList: false,
    activeQuality: false,
  };
  private fileId = '';
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
  private loadId = 0;
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
  /** The title's stored subtitle settings, and what they resolve to once the first start asks. */
  private subtitleWatch: SubtitleWatchFields = {};
  private subtitle: SubtitleSettings = subtitleSettings({});
  /**
   * Who decides the subtitle: `pending` until the first plan resolves it from the settings,
   * `following` while it is that resolved one (an audio pick resolves it again), `manual` once the
   * viewer or the server changed it, or a start named it. A session that starts anew keeps it.
   */
  private subtitleAuto: 'pending' | 'following' | 'manual';
  /** The subtitle (none = `undefined`) an automatic `track_change` in flight asks the plan for. */
  private requestedSubtitle: { id: string | undefined } | null = null;

  private readonly progress: ProgressReporter;
  private readonly stopSequence: StopSequence;
  private readonly watchdog: FirstFrameWatchdog;
  private readonly replanner: Replanner;
  private readonly recovery: Recovery;
  private readonly buffering: BufferingManager;

  constructor(private readonly deps: ControllerDeps) {
    this.quality = deps.intent?.quality ?? null;
    this.pinnedFile = deps.intent?.fileId !== undefined;
    this.tracks = { audio: deps.intent?.audio, subtitle: deps.intent?.subtitle };
    // A start that names a subtitle is the viewer's pick: the settings do not overrule it.
    this.subtitleAuto = deps.intent?.subtitle !== undefined ? 'manual' : 'pending';
    this.progress = new ProgressReporter({
      client: deps.client,
      installationId: () => this.server.id,
      sessionId: () => this.sessionId,
      isStopped: () => this.stopped,
      reading: () => this.reading(),
      hasPlayed: () => this.hasPlayed,
      isPlaying: () => this.playing,
      onEnded: () => this.sessionGone(),
      onExpired: (position) => void this.recovery.restartAt(position),
    });
    this.stopSequence = new StopSequence({
      client: deps.client,
      installationId: () => this.server.id,
      nextSequence: () => this.progress.nextSequence(),
    });
    this.watchdog = new FirstFrameWatchdog({
      isStopped: () => this.stopped,
      engine: () => this.engine,
      onStall: (failure, classification) =>
        void this.recovery.onMediaError(failure, classification),
    });
    this.replanner = new Replanner({
      client: deps.client,
      isStopped: () => this.stopped,
      plan: () => this.plan,
      capabilities: () => this.capabilities,
      context: () => this.context,
      state: () => ({
        sessionId: this.sessionId,
        installationId: this.server.id,
        attemptId: this.attemptId,
        planAttemptId: this.planAttemptId,
        attemptedKeys: this.attemptedKeys,
        quality: this.quality,
        startPosition: this.startPosition,
        hasPlayed: this.hasPlayed,
        loadId: this.loadId,
      }),
      reading: () => this.reading(),
      bandwidthCap: () => this.deps.bandwidthCap?.() ?? null,
      buffering: () => ({ ...this.bufferingSettings(), keptKbps: this.buffering.keptKbps }),
      onQualityFallback: () => this.buffering.qualityFellBack(),
      refreshProfile: async () => {
        const profile = await readDeviceProfile();
        this.capabilities = profile.capabilities;
        this.context = profile.context;
        return profile;
      },
      setStartPosition: (position) => {
        this.startPosition = position;
      },
      setQuality: (quality) => {
        this.quality = quality;
      },
      adopt: (plan, sessionId, options) => this.adopt(plan, sessionId, options),
      engine: () => this.engine,
      origin: () => this.origin,
      recoveryActive: () => this.recovery.active,
      fail: (reason, message, code) => this.fail(reason, message, code),
      sessionGone: () => this.sessionGone(),
      restartAt: (position) => this.recovery.restartAt(position),
    });
    this.recovery = new Recovery({
      isStopped: () => this.stopped,
      isReplanning: () => this.replanner.isReplanning,
      ready: () => Boolean(this.plan && this.capabilities && this.context),
      loadId: () => this.loadId,
      hasPlayed: () => this.hasPlayed,
      viewerPaused: () => this.viewerPaused,
      startPosition: () => this.startPosition,
      reading: () => this.reading(),
      plan: () => this.plan,
      reportFailure: (failure) => this.deps.onMediaError(failure),
      markNotPlaying: () => {
        this.playing = false;
      },
      disarmWatchdog: () => this.watchdog.disarm(),
      takeQualityLoad: () => this.replanner.takeQualityLoad(),
      replan: (operation, options) => this.replanner.replan(operation, options),
      sendPausedProgress: () => this.progress.send(true),
      fail: (reason, message, code) => this.fail(reason, message, code),
      sessionGone: () => this.sessionGone(),
      prepareRestart: () => this.prepareRestart(),
      start: (position) => this.start(position),
    });
    this.buffering = new BufferingManager({
      settings: () => this.bufferingSettings(),
      plan: () => this.plan,
      quality: () => this.quality,
      engine: () => this.engine,
      isStopped: () => this.stopped,
      isReplanning: () => this.replanner.isReplanning,
      recoveryActive: () => this.recovery.active,
      qualityChange: (label, extra) => this.replanner.qualityChange(label, extra),
      onView: (view) => {
        if (!this.disposed) this.deps.onBuffering?.(view);
      },
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private bufferingSettings(): { feature: boolean; mode: BufferingMode } {
    return this.deps.buffering?.() ?? { feature: false, mode: 'always' };
  }

  private set(state: SessionState): void {
    if (!this.disposed) this.deps.onState(state);
  }

  private fail(reason: SessionFailure, message?: string, code?: string): void {
    // An errored session is not worth a heartbeat.
    this.progress.clearTimer();
    this.watchdog.disarm();
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

  private sessionGone(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.progress.clearTimer();
    this.progress.dropPending();
    this.recovery.cancelWait();
    this.fail('sessionEnded');
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
      const [server, watch] = await Promise.all([
        loadInstallation(this.deps.client, this.deps.baseUrl),
        loadWatch(this.deps.client, this.deps.contentId, this.deps.intent?.fileId),
      ]);
      if (this.disposed) return;
      this.server = server;
      this.versions = watch.versions;
      this.item = watch.item;
      this.fileId = watch.fileId;
      this.resumeAt = watch.resume;
      this.heading = watch.heading;
      this.subtitleWatch = watch.subtitles;
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
    this.replanner.dropQueuedSeek();
    this.buffering.started();
    this.startPosition = position;
    try {
      // The first start decides the quality: the intent's, else what the profile prefers (the
      // server does not apply that setting itself). Later starts keep what the viewer picked.
      this.quality ??= (await this.deps.profileQuality?.()) ?? 'auto';
      if (this.disposed) return;
      // Read before the start, not after it: a start that is left in flight must not wait on this.
      if (this.subtitleAuto === 'pending') {
        this.subtitle = subtitleSettings(this.subtitleWatch, await this.deps.subtitleDefaults?.());
        if (this.disposed) return;
      }
      const profile = await readDeviceProfile();
      this.capabilities = profile.capabilities;
      this.context = profile.context;
      this.attemptId = uuidV4();
      const answer = await requestStart(this.deps.client, {
        installationId: this.server.id,
        fileId: this.fileId,
        pinnedFile: this.pinnedFile,
        profileId: this.profileId,
        attemptId: this.attemptId,
        quality: this.quality,
        bandwidthCapKbps: this.deps.bandwidthCap?.() ?? null,
        buffering: this.bufferingSettings(),
        position,
        tracks: this.tracks,
        capabilities: this.capabilities,
        context: this.context,
      });
      if (this.disposed) {
        // Left while the start was in flight: end the session the server just created.
        this.unload();
        if (answer.data?.session_id) await this.stopSequence.send(answer.data.session_id);
        return;
      }
      const outcome = interpretStart(answer, retryInstallation);
      if (outcome.kind === 'installationChanged') {
        // The server was replaced or restored: read its capabilities again, new attempt.
        forgetInstallation(this.deps.baseUrl);
        this.server = await loadInstallation(this.deps.client, this.deps.baseUrl);
        await this.start(position, false);
      } else if (outcome.kind === 'failed') {
        this.fail(outcome.reason);
      } else if (outcome.kind === 'playable') {
        await this.adoptFirst(outcome.plan, outcome.sessionId);
      } else {
        this.fail('terminal', outcome.message, outcome.reason);
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
    options: { forceReload?: boolean; autoplay?: boolean; hold?: boolean } = {},
  ): void {
    const previous = this.plan;
    // A replan that moved the subtitle by itself (not to the one just asked for) made the server's
    // choice: it stays, and the settings no longer decide.
    if (this.subtitleAuto === 'following' && previous) {
      const expected = this.requestedSubtitle
        ? this.requestedSubtitle.id
        : previous.selected_tracks.subtitle?.id;
      if (plan.selected_tracks.subtitle?.id !== expected) this.subtitleAuto = 'manual';
    }
    // HLS plays through hls.js, which authenticates with headers: its URL carries no token, so a
    // token refresh never changes it and never reloads the stream. (The screen builds the token
    // URL itself on the native fallback.) Direct play needs the token in the URL.
    const url = mediaUrlWithToken(
      plan.stream.url,
      this.deps.baseUrl,
      isHlsStream(plan.stream) ? undefined : this.deps.session.get()?.accessToken,
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
    this.buffering.adopted(reload);
    if (reload) {
      this.loadId += 1;
      this.playing = false;
      this.wasPaused = false;
      // A new load must prove itself again before progress counts, and finds its own origin.
      this.hasPlayed = false;
      this.origin = 0;
      // The old element is replaced; the new one arms the watchdog when it is attached.
      this.watchdog.disarm();
    }
    // `hold`: the plan is the current one, but the screen waits for the replan that follows.
    if (!options.hold) this.publishReady(plan, options.autoplay);
  }

  private publishReady(plan: Plan, autoplay?: boolean): void {
    this.set({
      kind: 'ready',
      plan,
      sessionId: this.sessionId,
      mediaUrl: this.mediaUrl,
      loadId: this.loadId,
      autoplay: autoplay ?? !this.viewerPaused,
      heading: this.heading,
      previews: previewFacts(plan, this.versions, this.server),
      media: mediaFacts(plan, this.versions, this.item),
      quality: this.quality ?? 'auto',
      activeQualityFeature: this.server.activeQuality,
      qualityFallbacks: this.replanner.qualityFallbacks,
    });
  }

  /**
   * The first plan of a viewing. Silo's server names no subtitle by itself, so the profile's
   * subtitle settings are resolved here; when the result is not what the plan plays, one
   * `track_change` goes out before the video shows, so the stream loads once. A refused or failed
   * change leaves the plan as it is, without a word.
   */
  private async adoptFirst(plan: Plan, sessionId: string): Promise<void> {
    if (this.subtitleAuto !== 'pending') {
      this.adopt(plan, sessionId);
      return;
    }
    this.subtitleAuto = 'following';
    const wanted = this.resolveSubtitle(plan, plan.selected_tracks.audio?.index);
    if (wanted?.track_id === plan.selected_tracks.subtitle?.id) {
      this.adopt(plan, sessionId);
      return;
    }
    this.adopt(plan, sessionId, { hold: true });
    const result = await this.automaticTrackChange(
      { ...(plan.selected_tracks.audio ? { audio: plan.selected_tracks.audio } : {}) },
      wanted,
    );
    // An applied change was shown by its own plan; a failure that ended the session shows the error.
    if (['refused', 'transient', 'busy'].includes(result.kind) && !this.stopped) {
      this.publishReady(plan);
    }
  }

  /** What the settings pick for the audio at `audioIndex`, from the plan's subtitle inventory. */
  private resolveSubtitle(plan: Plan, audioIndex: number | undefined): InventoryItem | null {
    const version = this.versions.find((v) => v.fileId === plan.effective_media_file_id);
    return resolveSubtitle(
      this.subtitle,
      plan.subtitle?.inventory ?? [],
      playingAudioLanguage(version, audioIndex),
    );
  }

  /**
   * A `track_change` the settings ask for: `selected` plus `wanted` (none = no subtitle member).
   * One that did not take effect is pinned like a viewer's pick, so the settings do not ask again
   * (the web player does the same after a refused automatic change).
   */
  private async automaticTrackChange(
    selected: SelectedTracks,
    wanted: InventoryItem | null,
  ): Promise<ReplanResult> {
    this.requestedSubtitle = { id: wanted?.track_id };
    const tracks: SelectedTracks = {
      ...selected,
      ...(wanted ? { subtitle: { id: wanted.track_id, index: wanted.combined_index } } : {}),
    };
    try {
      const result = await this.replanner.trackChange(tracks);
      if (result.kind !== 'applied') this.subtitleAuto = 'manual';
      return result;
    } finally {
      this.requestedSubtitle = null;
    }
  }

  /** The session is gone on the server: forget it, but keep the tracks playing now. */
  private prepareRestart(): void {
    // A session that starts anew is the same viewing: it carries the tracks that play now.
    this.subtitleAuto = 'manual';
    if (this.plan) {
      this.tracks = {
        audio: this.plan.selected_tracks.audio,
        subtitle: this.plan.selected_tracks.subtitle,
      };
    }
    // Nothing to stop on the server any more; the new session counts from its own start.
    this.sessionId = '';
    this.progress.reset();
    this.attemptedKeys = [];
    this.replanner.resetRecoveries();
    this.plan = null;
    this.hasPlayed = false;
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
    this.buffering.attach(engine);
    this.watchdog.expect(engine !== null && !this.stopped);
  }

  /** Unloads the video: the decoder is freed and the element has no source. Safe to repeat. */
  private unload(): void {
    const engine = this.engine;
    this.engine = null;
    engine?.release();
  }

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
    this.watchdog.disarm();
    if (!engine || !plan) return;
    this.origin = plausible(engine.currentTime) ? engine.currentTime : 0;
    // A seek the viewer asked for during the replan that started this load replaces the plan's
    // start seek: one seek, from the new origin.
    const owed = this.replanner.takeLoadSeek(this.loadId);
    if (owed !== null) void this.replanner.seekTo(owed);
    // A Restore that waited for this seek goes out now (after it, if the seek started a replan).
    this.replanner.releaseRestore();
    if (owed !== null) return;
    const start = plan.timeline.player_start_seconds;
    if (start > 0) engine.seek(this.origin + start);
  }

  onPlaying(): void {
    if (this.stopped) return;
    this.hasPlayed = true;
    this.playing = true;
    this.buffering.playing();
    this.viewerPaused = false;
    if (this.wasPaused) {
      this.wasPaused = false;
      this.progress.send(false);
    }
    this.progress.startHeartbeat();
  }

  /** The player ran out of data: the buffering controller decides whether that is a stall. */
  onWaiting(): void {
    this.buffering.waiting();
  }

  /** The player seeks: the buffering that follows belongs to the seek. */
  onSeeking(): void {
    this.buffering.seeking();
  }

  onPause(): void {
    // The element's own pause event follows a pause made here: report once.
    if (this.stopped || this.wasPaused) return;
    this.buffering.paused();
    this.playing = false;
    this.wasPaused = true;
    this.viewerPaused = true;
    this.progress.send(true);
  }

  /** The stream played to its end: stop with the end position, then hand over. */
  onEnded(): void {
    if (this.stopped) return;
    this.buffering.interrupted();
    void this.stop();
    if (!this.disposed) this.deps.onEnded();
  }

  /** A MediaError: a lost connection reconnects; any other failure replans for another route. */
  onMediaError(failure: MediaFailure, classification?: string): Promise<void> {
    this.buffering.interrupted();
    return this.recovery.onMediaError(failure, classification);
  }

  /** A hidden document (the viewer left the app) pauses and reports at once. */
  private readonly onVisibility = (): void => {
    // The watchdog does not run while the page is hidden; it starts over when it is shown again.
    if (document.visibilityState === 'hidden') this.watchdog.clear();
    else this.watchdog.arm();
    if (document.visibilityState !== 'hidden' || this.stopped) return;
    const engine = this.engine;
    if (!engine || engine.paused) return;
    engine.pause();
    this.onPause();
  };

  // --- Seeking and replans ----------------------------------------------------------------------

  /** Moves to a position on the source's timeline; the server moves the timeline when it must. */
  seekTo(sourceSeconds: number): Promise<void> {
    return this.replanner.seekTo(sourceSeconds);
  }

  /**
   * Switches the audio and subtitle (an omitted subtitle means off); `kind` is what the viewer
   * picked. A subtitle pick, even a refused one, ends the settings' choice for this session. An
   * audio pick, while the subtitle is still the one the settings chose, chooses again for the new
   * audio and sends the result with the audio change, as Silo's web player does.
   */
  trackChange(selected: SelectedTracks, kind: 'audio' | 'subtitle'): Promise<ReplanResult> {
    if (kind === 'subtitle') this.subtitleAuto = 'manual';
    const plan = this.plan;
    if (this.subtitleAuto !== 'following' || !plan) return this.replanner.trackChange(selected);
    const wanted = this.resolveSubtitle(plan, selected.audio?.index);
    return this.automaticTrackChange(
      { ...(selected.audio ? { audio: selected.audio } : {}) },
      wanted,
    );
  }

  /** Switches to a quality label from the plan's `available_qualities` (or `auto`). */
  async qualityChange(label: string): Promise<ReplanResult> {
    // The viewer's pick: its pills go now; the answer and the kept estimate change when it is adopted.
    this.buffering.pickSent();
    const result = await this.replanner.qualityChange(label);
    if (result.kind === 'applied') this.buffering.pickApplied();
    else this.buffering.pickFailed();
    return result;
  }

  /** The viewer's answer to the buffering prompt or the undo pill, or its timeout. */
  bufferingAnswer(answer: BufferingAnswer): void {
    this.buffering.answer(answer);
  }

  /** The buffering offer with this id is on screen now. */
  bufferingShown(id: number): void {
    this.buffering.shown(id);
  }

  /** Any replan operation of the protocol; the result tells what happened. */
  replan(operation: ReplanOperation, options: ReplanOptions = {}): Promise<ReplanResult> {
    return this.replanner.replan(operation, options);
  }

  // --- Stop ----------------------------------------------------------------------------------

  /** Ends the session on the server with the final position. Safe to call more than once. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.buffering.dispose();
    this.replanner.dropQueuedSeek();
    this.progress.clearTimer();
    this.progress.dropPending();
    this.recovery.cancelWait();
    this.watchdog.disarm();
    // The final reading first, then the unload, then (later) the stop: see STOP_AFTER_UNLOAD_MS.
    const reading = this.sessionId ? this.reading() : null;
    this.unload();
    if (!this.sessionId) return Promise.resolve();
    return this.stopSequence.send(this.sessionId, reading);
  }

  /** The screen is gone: end the session, and one still being started when it arrives. */
  dispose(): void {
    void this.stop();
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
