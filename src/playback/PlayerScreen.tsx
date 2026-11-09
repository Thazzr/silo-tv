import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { useBackHandler, useWheelSuspended } from '../app/nav';
import { Button, Screen } from '../app/ui';
import { useSilo } from '../app/SiloContext';
import { useT, type MessageKey } from '../i18n';
import { getPlatform } from '../platform';
import { formatClock, redact } from './format';
import { PlayerDiagnostics } from './PlayerDiagnostics';
import type { StartIntent } from './resume';
import {
  usePlaybackSession,
  type PlaybackSession,
  type PlayerReading,
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
}

/** Plays one title through the playback session: resume prompt, full-screen video, diagnostics. */
export function PlayerScreen({ contentId, title, intent, onExit }: PlayerScreenProps) {
  // The player has its own keys; the wheel would only press Up and Down there.
  useWheelSuspended();
  const t = useT();
  const { session: auth } = useSilo();
  const playback = usePlaybackSession(contentId, intent);
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
      token={token}
      playback={playback}
      onExit={onExit}
    />
  );
}

/** The target moved to the nearest seekable position; unchanged when it is already inside one. */
function withinSeekable(el: HTMLVideoElement, target: number): number {
  const ranges = el.seekable;
  let best = el.currentTime;
  let distance = Infinity;
  for (let i = 0; i < ranges.length; i += 1) {
    const clamped = Math.min(ranges.end(i), Math.max(ranges.start(i), target));
    const d = Math.abs(clamped - target);
    if (d < distance) {
      distance = d;
      best = clamped;
    }
  }
  return best;
}

function PlayingView({
  plan,
  sessionId,
  mediaUrl,
  token,
  playback,
  onExit,
}: {
  plan: Plan;
  sessionId: string;
  mediaUrl: string;
  token: string | undefined;
  playback: PlaybackSession;
  onExit: () => void;
}) {
  const t = useT();
  const { bindPlayer, onPlaying, onPause, onMediaError, stop, mediaError } = playback;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // The container's own first timestamp: Chromium keeps it for Matroska.
  const originRef = useRef(0);
  const latestRef = useRef<PlayerReading | null>(null);
  const [showing, setShowing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [diagnostics, setDiagnostics] = useState(false);
  const offset = plan.timeline.timeline_offset_seconds;
  const total = plan.source.duration_seconds;

  const setRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    setVideo(element);
  }, []);

  // The source-timeline position the server wants in progress and stop calls. After the element
  // is gone the last reading stands in, so a stop on unmount still carries a position.
  const read = useCallback((): PlayerReading | null => {
    const el = videoRef.current;
    if (!el) return latestRef.current;
    const reading = {
      position: Math.max(0, el.currentTime - originRef.current) + offset,
      paused: el.paused,
    };
    latestRef.current = reading;
    return reading;
  }, [offset]);

  useEffect(() => {
    bindPlayer(read);
    return () => bindPlayer(null);
  }, [bindPlayer, read]);

  // Layout cleanups run before React detaches the video, so the last position is still readable.
  useLayoutEffect(
    () => () => {
      read();
    },
    [read],
  );

  const leave = useCallback(() => {
    void stop();
    onExit();
  }, [stop, onExit]);

  // Back goes through the screen stack like everywhere else; only the stop key is handled below.
  useBackHandler(leave);

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void Promise.resolve(el.play()).catch(() => undefined);
    else el.pause();
  }, []);

  const seek = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el) return;
      // Never past the ends: the engine's duration, else the source's own runtime.
      const end = Number.isFinite(el.duration)
        ? el.duration
        : total !== undefined
          ? originRef.current + total - offset
          : Infinity;
      const target = Math.min(end, Math.max(originRef.current, el.currentTime + delta));
      // A plan the server cannot seek (copy remux over HLS) only has the ranges the player
      // holds. Moving the server-side timeline (a seek_reanchor replan) comes in Phase 3.
      el.currentTime = plan.timeline.can_seek_anywhere ? target : withinSeekable(el, target);
    },
    [total, offset, plan.timeline.can_seek_anywhere],
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
          if (videoRef.current?.paused) toggle();
          break;
        }
        case 'pause': {
          handled();
          if (videoRef.current && !videoRef.current.paused) toggle();
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
  }, [toggle, seek, leave]);

  const onLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    originRef.current = el.currentTime;
    const start = plan.timeline.player_start_seconds;
    if (start > 0) el.currentTime = originRef.current + start;
  };

  const duration = total ?? (video && Number.isFinite(video.duration) ? video.duration : 0);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const cue = !showing && !paused;

  return (
    <div className="player" data-testid="player">
      <video
        ref={setRef}
        className="player-video"
        src={mediaUrl}
        autoPlay
        onLoadedMetadata={onLoadedMetadata}
        onPlaying={() => {
          setShowing(true);
          setPaused(false);
          onPlaying();
        }}
        onWaiting={() => setShowing(false)}
        onPause={(e) => {
          // The pause that comes with the end of the stream is not the viewer's.
          if (e.currentTarget.ended) return;
          setPaused(true);
          onPause();
        }}
        onEnded={leave}
        onTimeUpdate={() => setPosition(read()?.position ?? 0)}
        onError={(e) => {
          setShowing(false);
          const error = e.currentTarget.error;
          onMediaError({ code: error?.code ?? 0, message: error?.message ?? '' });
        }}
        onClick={toggle}
      />
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
