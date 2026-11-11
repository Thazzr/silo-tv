// The React hook for one playback: it ties the lifetime of a PlaybackController (the protocol
// logic, in ./session) to a component and hands the screen its state and its player callbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSilo } from '../app/SiloContext';
import type { PlayerEngine } from './engine/PlayerEngine';
import type { StartIntent } from './resume';
import type { BufferingMode } from './session/bufferingQuality';
import {
  NO_BUFFERING_VIEW,
  type BufferingAnswer,
  type BufferingView,
} from './session/BufferingManager';
import { PlaybackController } from './session/PlaybackController';
import type {
  MediaFailure,
  PlayerReading,
  ReplanResult,
  SelectedTracks,
  SessionState,
} from './session/types';

export interface ProfileQuality {
  known: boolean;
  quality: string;
  /** The profile's `playback.max_bitrate_kbps`: sent on every start and replan; null = uncapped. */
  bandwidthCapKbps?: number | null;
  /** `playback.buffering_quality_mode`; absent = `always`. */
  bufferingMode?: BufferingMode;
  /** The server's settings know that key: the buffering request fields may be sent. */
  bufferingKnown?: boolean;
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
  onWaiting(): void;
  onSeeking(): void;
  onEnded(): void;
  onMediaError(failure: MediaFailure): void;
  seekTo(sourceSeconds: number): Promise<void>;
  trackChange(selected: SelectedTracks): Promise<ReplanResult>;
  qualityChange(label: string): Promise<ReplanResult>;
  stop(): Promise<void>;
  /** What the buffering controller offers: the prompt, the undo pill and the notices. */
  buffering: BufferingView;
  bufferingAnswer(answer: BufferingAnswer): void;
  bufferingShown(id: number): void;
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
  const [buffering, setBuffering] = useState<BufferingView>(NO_BUFFERING_VIEW);
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
  const bandwidthCap = useCallback(() => profileRef.current.profile.bandwidthCapKbps ?? null, []);
  const bufferingSettings = useCallback(
    () => ({
      feature: profileRef.current.profile.bufferingKnown ?? false,
      mode: profileRef.current.profile.bufferingMode ?? 'always',
    }),
    [],
  );
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
      bandwidthCap,
      buffering: bufferingSettings,
      onBuffering: setBuffering,
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
  }, [
    client,
    baseUrl,
    session,
    contentId,
    intent?.kind,
    profileQuality,
    bandwidthCap,
    bufferingSettings,
  ]);

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
  const onWaiting = useCallback(() => controller.current?.onWaiting(), []);
  const onSeeking = useCallback(() => controller.current?.onSeeking(), []);
  const bufferingAnswer = useCallback(
    (answer: BufferingAnswer) => controller.current?.bufferingAnswer(answer),
    [],
  );
  const bufferingShown = useCallback((id: number) => controller.current?.bufferingShown(id), []);
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
      onWaiting,
      onSeeking,
      onEnded: onEnd,
      onMediaError,
      seekTo,
      trackChange,
      qualityChange,
      stop,
      buffering,
      bufferingAnswer,
      bufferingShown,
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
      onWaiting,
      onSeeking,
      onEnd,
      onMediaError,
      seekTo,
      trackChange,
      qualityChange,
      stop,
      buffering,
      bufferingAnswer,
      bufferingShown,
    ],
  );
}
