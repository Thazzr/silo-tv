import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { suspendWheel, useBackHandler } from '../app/nav';
import { Button, Screen } from '../app/ui';
import { useSilo } from '../app/SiloContext';
import { useT, type MessageKey } from '../i18n';
import { useProfileSetting, useProfileSettings } from '../features/settings/profileSettings';
import { HtmlVideoEngine } from './engine/HtmlVideoEngine';
import type { PlayerEngine } from './engine/PlayerEngine';
import { formatClock, redact } from './format';
import { ChaptersMenu } from './menus/ChaptersMenu';
import { currentChapter } from './menus/info';
import { InfoColumn } from './menus/InfoColumn';
import { qualityLabel, qualityMenu } from './menus/qualityMenu';
import { SettingsMenu, settingsRowKeys } from './menus/SettingsMenu';
import { isPopover, MENU_ORDER, usePanelState, type PanelState } from './menus/usePanelState';
import { PlayerOsd } from './osd/PlayerOsd';
import { bufferedUntil, SPINNER_DELAY_MS, SPINNER_MIN_MS, titleBlock } from './osd/timing';
import { useDelayedFlag } from './osd/useDelayedFlag';
import { usePlayerControls } from './osd/usePlayerControls';
import { useTrickplay } from './osd/useTrickplay';
import { PlayerDiagnostics } from './PlayerDiagnostics';
import { bandFractions } from './skip/segments';
import { SkipPillButton } from './skip/SkipPill';
import { useSkipPill } from './skip/useSkipPill';
import { PlayerSubtitles } from './subtitles/SubtitleOverlay';
import type { StartIntent } from './resume';
import {
  usePlaybackSession,
  type PlaybackSession,
  type Heading,
  type MediaFacts,
  type PreviewFacts,
  type Plan,
  type SessionFailure,
} from './usePlaybackSession';

const ERROR_TEXT: Record<SessionFailure, MessageKey> = {
  unsupported: 'player.error.unsupported',
  noFile: 'player.error.noFile',
  terminal: 'player.error.terminal',
  failed: 'player.error.failed',
  sessionEnded: 'player.error.sessionEnded',
};

export interface PlayerScreenProps {
  contentId: string;
  title: string;
  /** How to start; the default asks when there is something to resume. */
  intent?: StartIntent;
  onExit: () => void;
  /** The stream played to its end and the session is stopped. Defaults to leaving the player. */
  onEnded?: () => void;
}

/** Plays one title through the playback session: resume prompt, full-screen video, diagnostics. */
export function PlayerScreen({ contentId, title, intent, onExit, onEnded }: PlayerScreenProps) {
  const t = useT();
  const { session: auth } = useSilo();
  const panel = usePanelState();
  // The session has shown its first frame. It lives here, above the playing view: a reload of the
  // stream (a replan, a seek that needs a new stream) mounts a new view, and the keys must not
  // go dead until a frame plays again (a paused reload never plays one).
  const [started, setStarted] = useState(false);
  const markStarted = useCallback(() => setStarted(true), []);
  // The player has its own keys; the wheel would only press Up and Down there. An open menu is a
  // list like any other, so the wheel moves its focus while it is open.
  const popoverOpen = isPopover(panel.open);
  useEffect(() => (popoverOpen ? undefined : suspendWheel()), [popoverOpen]);
  // A start with no quality of its own sends the profile's preferred one, once it is known.
  const profileSettings = useProfileSettings();
  const preferredQuality = profileSettings.values['playback.preferred_quality'];
  const profile = useMemo(
    () => ({ known: profileSettings.known, quality: preferredQuality }),
    [profileSettings.known, preferredQuality],
  );
  const playback = usePlaybackSession(contentId, intent, onEnded ?? onExit, profile);
  const { state } = playback;
  const token = auth.get()?.accessToken;

  if (state.kind === 'loading' || state.kind === 'starting') {
    return (
      <Screen title={title} onBack={onExit} testId="player-loading">
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('player.loading')}
        </p>
      </Screen>
    );
  }

  if (state.kind === 'prompt') {
    return (
      <Screen title={title} onBack={onExit} testId="resume-prompt">
        <Button focusKey="resume" autoFocus onClick={() => playback.resume()}>
          {t('player.resumeFrom', { time: formatClock(state.positionSeconds) })}
        </Button>
        <Button focusKey="start-over" onClick={() => playback.choose(0)}>
          {t('player.startOver')}
        </Button>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title={title} onBack={onExit} testId="player-error">
        <p role="alert" className="error">
          {t(ERROR_TEXT[state.reason])}
        </p>
        {state.message ? <p>{redact(state.message, [token, state.mediaUrl])}</p> : null}
        <Button focusKey="player-back" autoFocus onClick={onExit}>
          {t('player.back')}
        </Button>
        {state.plan ? (
          <PlayerDiagnostics
            plan={state.plan}
            sessionId={state.sessionId}
            video={null}
            mediaError={playback.mediaError}
            secrets={[token, state.mediaUrl]}
          />
        ) : null}
      </Screen>
    );
  }

  return (
    <PlayingView
      key={state.loadId}
      plan={state.plan}
      sessionId={state.sessionId}
      mediaUrl={state.mediaUrl}
      autoplay={state.autoplay}
      heading={state.heading}
      previews={state.previews}
      media={state.media}
      quality={state.quality}
      activeQualityFeature={state.activeQualityFeature}
      panel={panel}
      started={started}
      onStarted={markStarted}
      contentId={contentId}
      title={title}
      token={token}
      playback={playback}
      onExit={onExit}
    />
  );
}

function PlayingView({
  plan,
  sessionId,
  mediaUrl,
  autoplay,
  heading,
  previews,
  media,
  quality,
  activeQualityFeature,
  panel,
  started,
  onStarted,
  contentId,
  title,
  token,
  playback,
  onExit,
}: {
  plan: Plan;
  sessionId: string;
  mediaUrl: string;
  autoplay: boolean;
  heading: Heading | null;
  previews: PreviewFacts;
  media: MediaFacts;
  quality: string;
  activeQualityFeature: boolean;
  panel: PanelState;
  started: boolean;
  onStarted(): void;
  contentId: string;
  title: string;
  token: string | undefined;
  playback: PlaybackSession;
  onExit: () => void;
}) {
  const t = useT();
  const {
    attachEngine,
    reading,
    onLoadedMetadata,
    onPlaying,
    onPause,
    onEnded,
    onMediaError,
    seekTo,
    stop,
    mediaError,
  } = playback;
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  // `showing`: a frame is on screen now; `started`: the first frame has played.
  const [showing, setShowing] = useState(false);
  const [paused, setPaused] = useState(!autoplay);
  const [position, setPosition] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [diagnostics, setDiagnostics] = useState(false);
  const skipBack = useProfileSetting('player.video_skip_back_seconds').value;
  const skipForward = useProfileSetting('player.video_skip_forward_seconds').value;
  const settings = useProfileSettings();
  const total = plan.source.duration_seconds;
  const popoverOpen = isPopover(panel.open);

  // The menu buttons the playing file has something for, in the order of the row. Audio and
  // Subtitles take their places here with their menus.
  const qualities = useMemo(
    () => qualityMenu(plan, quality, activeQualityFeature),
    [plan, quality, activeQualityFeature],
  );
  const hasSettings = settingsRowKeys(qualities, media.isEpisode).length > 0;
  const hasChapters = previews.chapters.length > 0;
  const menus = useMemo(
    () =>
      MENU_ORDER.filter(
        (id) =>
          id === 'info' || (id === 'chapters' && hasChapters) || (id === 'settings' && hasSettings),
      ),
    [hasChapters, hasSettings],
  );
  // A menu the new stream has nothing for (its chapters or choices are gone) closes.
  const hidePanel = panel.hide;
  useEffect(() => {
    if (panel.open && !menus.includes(panel.open)) hidePanel();
  }, [panel.open, menus, hidePanel]);

  // The element is rendered here; everything that controls playback goes through its engine.
  const setRef = useCallback(
    (element: HTMLVideoElement | null) => {
      setVideo(element);
      if (element) {
        const created = new HtmlVideoEngine(element);
        engineRef.current = created;
        attachEngine(created);
        setEngine(created);
      } else {
        // The controller takes the last position first, then the decoder is freed.
        attachEngine(null);
        engineRef.current?.release();
        engineRef.current = null;
        setEngine(null);
      }
    },
    [attachEngine],
  );

  const leave = useCallback(() => {
    void stop();
    onExit();
  }, [stop, onExit]);

  const duration = total ?? (video && Number.isFinite(video.duration) ? video.duration : 0);
  const buffering = !showing && !paused;
  // The pill waits for the first frame and for the profile's values, so a mode that skips by
  // itself is never taken for "ask" while the settings are still loading.
  const skip = useSkipPill({
    enabled: started && settings.known,
    segments: previews.segments,
    position,
    duration,
    introMode: settings.values['playback.intro_skip_mode'],
    autoSkipRecap: settings.values['playback.auto_skip_recap'],
    autoSkipCredits: settings.values['playback.auto_skip_credits'],
    seekTo: (sourceSeconds) => void seekTo(sourceSeconds),
  });
  const bands = useMemo(
    () => bandFractions(previews.segments, duration),
    [previews.segments, duration],
  );
  const controls = usePlayerControls({
    engine,
    started,
    paused,
    buffering,
    position,
    duration,
    read: () => reading()?.position ?? null,
    seekTo: (sourceSeconds) => void seekTo(sourceSeconds),
    leave,
    toggleDiagnostics: () => setDiagnostics((on) => !on),
    skipBackSeconds: skipBack,
    skipForwardSeconds: skipForward,
    menus,
    panel,
    pill: {
      shown: skip.pill !== null,
      holdsFocus: skip.focusWindow,
      activate: skip.activate,
      dismiss: skip.dismiss,
    },
  });

  // Back goes through the screen stack like everywhere else; the controls decide what it does.
  useBackHandler(controls.back);

  // Subscribed before the source is set, so no early event is missed.
  useLayoutEffect(() => {
    if (!engine) return;
    const off = [
      engine.on('loadedmetadata', onLoadedMetadata),
      engine.on('playing', () => {
        setShowing(true);
        onStarted();
        setPaused(false);
        onPlaying();
      }),
      // A paused load (no autoplay) never plays a frame: its first decoded one counts as shown,
      // so there is no spinner and the keys work.
      engine.on('loadeddata', () => {
        // From here the controller's reading is the attempt's start, so the time and the scrubber
        // show where this load begins instead of 0:00 until playback resumes.
        setPosition(reading()?.position ?? 0);
        if (autoplay) return;
        setShowing(true);
        onStarted();
      }),
      engine.on('waiting', () => setShowing(false)),
      engine.on('pause', () => {
        // The pause that comes with the end of the stream is not the viewer's.
        if (engine.ended) return;
        setPaused(true);
        onPause();
      }),
      engine.on('ended', onEnded),
      engine.on('timeupdate', () => {
        const now = reading()?.position ?? 0;
        setPosition(now);
        setBufferedEnd(bufferedUntil(engine.buffered, engine.currentTime, now));
      }),
      engine.on('error', () => {
        setShowing(false);
        const error = engine.error;
        onMediaError({ code: error?.code ?? 0, message: error?.message ?? '' });
      }),
    ];
    engine.setSource(mediaUrl);
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [
    engine,
    mediaUrl,
    autoplay,
    reading,
    onStarted,
    onLoadedMetadata,
    onPlaying,
    onPause,
    onEnded,
    onMediaError,
  ]);

  // Read once per file, only when the server and this file's version both offer previews.
  const trickplay = useTrickplay(contentId, previews.fileId, previews.trickplay);
  const cue = useDelayedFlag(buffering, SPINNER_DELAY_MS, SPINNER_MIN_MS);
  const block = titleBlock(heading, title, media.year);
  const qualityInUse = qualities ? qualityLabel(qualities, quality) : null;
  const qualityText = qualityInUse
    ? qualityInUse.kind === 'auto'
      ? t('player.menu.quality.auto')
      : qualityInUse.name
    : null;

  /** The popover of the open menu, drawn above its button by the overlay. */
  let popover = null;
  if (panel.open === 'settings') {
    popover = (
      <SettingsMenu
        menu={qualities}
        preference={quality}
        episode={media.isEpisode}
        qualityChange={playback.qualityChange}
        remember={panel.remember}
        recall={panel.recall}
        onSide={controls.menuSide}
      />
    );
  } else if (panel.open === 'chapters') {
    popover = (
      <ChaptersMenu
        chapters={previews.chapters}
        current={currentChapter(previews.chapters, position)}
        remember={panel.remember}
        recall={panel.recall}
        onSide={controls.menuSide}
        onChoose={(start) => {
          // The jump shows: the menu closes and the overlay stays on the Chapters button.
          void seekTo(start);
          controls.closeMenu();
        }}
      />
    );
  }

  return (
    <div className="player" data-testid="player" onMouseMove={controls.pointerMoved}>
      <video
        ref={setRef}
        className="player-video"
        preload="auto"
        autoPlay={autoplay}
        onClick={controls.videoClicked}
      />
      {cue ? (
        <p className="player-cue loading" role="status" data-testid="player-cue">
          <span className="spinner" aria-hidden="true" />
          {t('player.loading')}
        </p>
      ) : null}
      <PlayerSubtitles plan={plan} position={position} lifted={controls.visible} />
      {/* Before the overlay, so the scrub preview card stands above it. */}
      {panel.open === 'info' ? <InfoColumn plan={plan} media={media} video={video} /> : null}
      <PlayerOsd
        visible={controls.visible}
        title={block.title}
        detail={block.detail}
        position={controls.shownPosition}
        duration={duration}
        bufferedEnd={bufferedEnd}
        focus={controls.focus}
        paused={paused}
        skipBackSeconds={skipBack}
        skipForwardSeconds={skipForward}
        scrub={controls.scrub}
        skipPending={controls.skipPending}
        chapters={previews.chapters}
        bands={bands}
        previews={trickplay}
        menus={menus}
        openMenu={panel.open}
        qualityText={qualityText}
        popover={popover}
        onFocus={controls.setFocus}
        onSeekFraction={controls.seekToFraction}
        onAction={controls.action}
      />
      {skip.pill && !popoverOpen ? (
        <SkipPillButton
          pill={skip.pill}
          focused={controls.focus === 'pill'}
          filling={skip.focusWindow}
          raised={controls.visible}
          onActivate={skip.activate}
          onFocus={() => controls.setFocus('pill')}
        />
      ) : null}
      {diagnostics || mediaError ? (
        <PlayerDiagnostics
          plan={plan}
          sessionId={sessionId}
          video={video}
          mediaError={mediaError}
          secrets={[mediaUrl, token]}
        />
      ) : null}
    </div>
  );
}
