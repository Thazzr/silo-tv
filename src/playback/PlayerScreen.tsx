import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBackHandler, useWheelSuspended } from '../app/nav';
import { Button, Screen } from '../app/ui';
import { useSilo } from '../app/SiloContext';
import { useT, type MessageKey } from '../i18n';
import { getPlatform } from '../platform';
import { HtmlVideoEngine } from './engine/HtmlVideoEngine';
import type { PlayerEngine } from './engine/PlayerEngine';
import { formatClock, redact } from './format';
import { PlayerDiagnostics } from './PlayerDiagnostics';
import type { StartIntent } from './resume';
import {
  usePlaybackSession,
  type PlaybackSession,
  type Plan,
  type SessionFailure,
} from './usePlaybackSession';

const SEEK_SECONDS = 10;

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
  // The player has its own keys; the wheel would only press Up and Down there.
  useWheelSuspended();
  const t = useT();
  const { session: auth } = useSilo();
  const playback = usePlaybackSession(contentId, intent, onEnded ?? onExit);
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
  token,
  playback,
  onExit,
}: {
  plan: Plan;
  sessionId: string;
  mediaUrl: string;
  autoplay: boolean;
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
  const [showing, setShowing] = useState(false);
  const [paused, setPaused] = useState(!autoplay);
  const [position, setPosition] = useState(0);
  const [diagnostics, setDiagnostics] = useState(false);
  const total = plan.source.duration_seconds;

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

  // Back goes through the screen stack like everywhere else; only the stop key is handled below.
  useBackHandler(leave);

  const toggle = useCallback(() => {
    if (!engine) return;
    if (engine.paused) void engine.play();
    else engine.pause();
  }, [engine]);

  const seek = useCallback(
    (delta: number) => {
      const current = reading();
      if (current) void seekTo(current.position + delta);
    },
    [reading, seekTo],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = getPlatform().mapKey(e);
      if (!key) return;
      const handled = () => e.preventDefault();
      switch (key) {
        case 'enter':
        case 'playPause':
          handled();
          toggle();
          break;
        case 'play': {
          handled();
          if (engine?.paused) toggle();
          break;
        }
        case 'pause': {
          handled();
          if (engine && !engine.paused) toggle();
          break;
        }
        case 'left':
        case 'rewind':
          handled();
          seek(-SEEK_SECONDS);
          break;
        case 'right':
        case 'fastForward':
          handled();
          seek(SEEK_SECONDS);
          break;
        case 'blue':
          handled();
          setDiagnostics((on) => !on);
          break;
        case 'stop':
          handled();
          leave();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, toggle, seek, leave]);

  // Subscribed before the source is set, so no early event is missed.
  useLayoutEffect(() => {
    if (!engine) return;
    const off = [
      engine.on('loadedmetadata', onLoadedMetadata),
      engine.on('playing', () => {
        setShowing(true);
        setPaused(false);
        onPlaying();
      }),
      engine.on('waiting', () => setShowing(false)),
      engine.on('pause', () => {
        // The pause that comes with the end of the stream is not the viewer's.
        if (engine.ended) return;
        setPaused(true);
        onPause();
      }),
      engine.on('ended', onEnded),
      engine.on('timeupdate', () => setPosition(reading()?.position ?? 0)),
      engine.on('error', () => {
        setShowing(false);
        const error = engine.error;
        onMediaError({ code: error?.code ?? 0, message: error?.message ?? '' });
      }),
    ];
    engine.setSource(mediaUrl);
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [engine, mediaUrl, reading, onLoadedMetadata, onPlaying, onPause, onEnded, onMediaError]);

  const duration = total ?? (video && Number.isFinite(video.duration) ? video.duration : 0);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const cue = !showing && !paused;

  return (
    <div className="player" data-testid="player">
      <video ref={setRef} className="player-video" autoPlay={autoplay} onClick={toggle} />
      {cue ? (
        <p className="player-cue loading" role="status" data-testid="player-cue">
          <span className="spinner" aria-hidden="true" />
          {t('player.loading')}
        </p>
      ) : null}
      <div className="player-bar" data-testid="player-bar">
        <span className="player-state">{paused ? t('player.paused') : ''}</span>
        <div className="player-track" aria-hidden="true">
          <div className="player-fill" style={{ transform: `scaleX(${ratio})` }} />
        </div>
        <span data-testid="player-time">
          {formatClock(position)} / {formatClock(duration)}
        </span>
      </div>
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
