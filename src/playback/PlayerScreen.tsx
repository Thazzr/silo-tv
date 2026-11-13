import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { suspendWheel, useBackHandler } from '../app/nav';
import { Button, Screen } from '../app/ui';
import { protectsEpisodeStill } from '../ui/media';
import { useSilo } from '../app/SiloContext';
import { useLanguage, useT, type MessageKey } from '../i18n';
import { SubtitleAppearanceDialog } from '../features/settings/SubtitleAppearanceDialog';
import {
  useProfileSetting,
  useProfileSettings,
  useServerKnowsSetting,
} from '../features/settings/profileSettings';
import { BufferingPill } from './buffering/BufferingPill';
import { useBufferingPill } from './buffering/useBufferingPill';
import { HtmlVideoEngine } from './engine/HtmlVideoEngine';
import type { PlayerEngine } from './engine/PlayerEngine';
import { formatClock, redact } from './format';
import { AudioMenu } from './menus/AudioMenu';
import { ChaptersMenu } from './menus/ChaptersMenu';
import { currentChapter, routeOf, type Route } from './menus/info';
import { InfoColumn } from './menus/InfoColumn';
import { qualityLabel, qualityMenu } from './menus/qualityMenu';
import { SettingsMenu } from './menus/SettingsMenu';
import { useSubtitleDelay } from './menus/subtitleDelay';
import { SubtitlesMenu } from './menus/SubtitlesMenu';
import {
  audioRows,
  subtitleRows,
  tracksForAudioPick,
  tracksForSubtitlePick,
  type TrackText,
} from './menus/trackMenus';
import { isPopover, MENU_ORDER, usePanelState, type PanelState } from './menus/usePanelState';
import { useEpisodeNeighbours, type EpisodeNeighbours } from './episodes/useEpisodeNeighbours';
import { PlayerOsd } from './osd/PlayerOsd';
import { bufferedUntil, SPINNER_DELAY_MS, SPINNER_MIN_MS, titleBlock } from './osd/timing';
import { useDelayedFlag } from './osd/useDelayedFlag';
import { usePlayerControls } from './osd/usePlayerControls';
import { useTrickplay } from './osd/useTrickplay';
import { SkipPillButton } from './skip/SkipPill';
import { useSkipPill } from './skip/useSkipPill';
import { PlayerSubtitles } from './subtitles/SubtitleOverlay';
import { autoplayRegion } from './upnext/autoplayRegion';
import { EndBackdrop } from './upnext/EndBackdrop';
import { EndScreen } from './upnext/EndScreen';
import { recordAutoAdvance, resetStillWatchingStreak } from './upnext/stillWatching';
import { UpNextCard } from './upnext/UpNextCard';
import { useUpNextCard } from './upnext/useUpNextCard';
import type { StartIntent } from './resume';
import { isHlsStream } from './engine/PlayerEngine';
import { authHeadersFor, mediaUrlWithToken } from './mediaUrl';
import { getTimeMode } from './timeDisplay';
import { trackPrefKey, useTrackPrefs, type TrackPrefWriter } from './trackPrefs';
import { usePlaybackSession, type PlaybackSession } from './usePlaybackSession';
import type { Heading, MediaFacts, PreviewFacts, Plan, SessionFailure } from './session/types';

/** How long the hint about a quality that did not play stays on screen. */
export const QUALITY_NOTICE_MS = 4_000;
/** How long the buffering notices ("Quality lowered", "can't go lower") stay on screen. */
export const BUFFERING_NOTICE_MS = 5_000;
/** The end screen comes up this long before the end of an episode (the web's post-roll). */
export const POST_ROLL_SECONDS = 30;

const ROUTE_TEXT: Record<Route, MessageKey> = {
  direct: 'player.info.routeDirect',
  remux: 'player.info.routeRemux',
  transcode: 'player.info.routeTranscode',
};

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
  /**
   * Opens another episode (previous or next) in this player's place. `automatic` is set when
   * nobody asked for it: the countdown of the credits card or the end screen ran out.
   */
  onEpisode: (episode: { contentId: string; title: string; automatic?: true }) => void;
  /**
   * This player was opened by an automatic start. Any other start is the viewer's and clears the
   * count of automatic advances in a row (the still-watching gate).
   */
  automatic?: boolean;
}

/** Plays one title through the playback session: resume prompt, full-screen video, diagnostics. */
export function PlayerScreen({
  contentId,
  title,
  intent,
  onExit,
  onEnded,
  onEpisode,
  automatic = false,
}: PlayerScreenProps) {
  const t = useT();
  const { session: auth } = useSilo();
  const panel = usePanelState();
  useEffect(() => {
    if (!automatic) resetStillWatchingStreak();
  }, [automatic]);
  // The session has shown its first frame. It lives here, above the playing view: a reload of the
  // stream (a replan, a seek that needs a new stream) mounts a new view, and the keys must not
  // go dead until a frame plays again (a paused reload never plays one).
  const [started, setStarted] = useState(false);
  const markStarted = useCallback(() => setStarted(true), []);
  const popoverOpen = isPopover(panel.open);
  // A start with no quality of its own sends the profile's preferred one, once it is known.
  const profileSettings = useProfileSettings();
  const preferredQuality = profileSettings.values['playback.preferred_quality'];
  const bandwidthCapKbps = profileSettings.values['playback.max_bitrate_kbps'];
  const bufferingMode = profileSettings.values['playback.buffering_quality_mode'];
  // A server whose settings do not know the key runs `always` and gets no buffering fields.
  const bufferingKnown = useServerKnowsSetting('playback.buffering_quality_mode');
  // The fallback for a title whose watch data stores no subtitle settings of its own.
  const subtitleMode = profileSettings.values['playback.subtitle_mode'];
  const subtitleLanguage = profileSettings.values['playback.subtitle_language'];
  const showForced = profileSettings.values['playback.show_forced_subtitles'];
  const profile = useMemo(
    () => ({
      known: profileSettings.known,
      quality: preferredQuality,
      bandwidthCapKbps,
      bufferingMode,
      bufferingKnown,
      subtitle: { mode: subtitleMode, language: subtitleLanguage, showForced },
    }),
    [
      profileSettings.known,
      preferredQuality,
      bandwidthCapKbps,
      bufferingMode,
      bufferingKnown,
      subtitleMode,
      subtitleLanguage,
      showForced,
    ],
  );
  // An episode that played to its end stays on the end screen; anything else leaves, as it did.
  const [ended, setEnded] = useState(false);
  const endsOnScreen = useRef(false);
  const handleEnded = useCallback(() => {
    if (endsOnScreen.current) setEnded(true);
    else (onEnded ?? onExit)();
  }, [onEnded, onExit]);
  const playback = usePlaybackSession(contentId, intent, handleEnded, profile);
  const { state, stop } = playback;
  const ready = state.kind === 'ready' ? state : null;
  useEffect(() => {
    endsOnScreen.current = ready?.media.isEpisode === true;
  });
  // The end screen: from 30 s before the end, or when the stream ended before that was noticed.
  const [postRollEntered, setPostRollEntered] = useState(false);
  const enterPostRoll = useCallback(() => setPostRollEntered(true), []);
  // A viewer who went back from the mini player to the picture is not taken to the end screen by
  // the 30 s again; the end of the stream still brings it up.
  const [returned, setReturned] = useState(false);
  const postRoll = ended || (postRollEntered && !returned);
  // The player has its own keys; the wheel would only press Up and Down there. An open menu is a
  // list like any other, and so is the end screen, so the wheel moves their focus while they show.
  const wheelFree = popoverOpen || postRoll;
  useEffect(() => (wheelFree ? undefined : suspendWheel()), [wheelFree]);
  // The viewer's cancel of the credits card holds for the rest of the episode.
  const [cancelled, setCancelled] = useState(false);
  const cancelCard = useCallback(() => setCancelled(true), []);
  // Going back to the picture also holds the credits card off: it would start the next episode
  // by itself under a viewer who just chose to keep watching this one.
  const returnToPicture = useCallback(() => {
    setReturned(true);
    setCancelled(true);
  }, []);
  // The next and previous episode, read here so a reloaded stream and the end screen share them.
  const neighbours = useEpisodeNeighbours(
    ready?.media.isEpisode ? ready.media.seriesId : undefined,
    ready?.heading?.seasonNumber ?? 0,
    ready?.heading?.episodeNumber ?? 0,
  );
  // The session ends as Back ends it; the host swaps this entry for the episode, which starts by
  // the resume rule with no tracks carried over.
  const startEpisode = useCallback(
    (target: { contentId: string; title: string }, byItself: boolean) => {
      void stop();
      if (byItself) recordAutoAdvance();
      const episode = { contentId: target.contentId, title: target.title };
      onEpisode(byItself ? { ...episode, automatic: true } : episode);
    },
    [stop, onEpisode],
  );
  const leave = useCallback(() => {
    void stop();
    onExit();
  }, [stop, onExit]);
  // The subtitle delay and the track saves live here, above the playing view: a track change may
  // reload the stream and mount a new view while a write is still due.
  const subtitleDelay = useSubtitleDelay();
  const trackPrefs = useTrackPrefs();
  const token = auth.get()?.accessToken;
  // A view that mounted for a pick that closed its menu has taken the arrival by now.
  const settlePanel = panel.settle;
  useEffect(() => settlePanel());

  // The hint for a quality change that went back to the quality before. It lives here, above the
  // playing view, which is mounted anew for every load (the fallback is one).
  const fallbacks = state.kind === 'ready' ? state.qualityFallbacks : 0;
  const [notice, setNotice] = useState(false);
  const seenFallbacks = useRef(0);
  useEffect(() => {
    if (fallbacks <= seenFallbacks.current) return undefined;
    seenFallbacks.current = fallbacks;
    setNotice(true);
    const handle = setTimeout(() => setNotice(false), QUALITY_NOTICE_MS);
    return () => clearTimeout(handle);
  }, [fallbacks]);

  // The buffering controller's notices, with the same reason as above to live here.
  const bufferingNotice = playback.buffering.notice;
  const [goneNotice, setGoneNotice] = useState(0);
  const noticeId = bufferingNotice?.id ?? 0;
  useEffect(() => {
    if (noticeId === 0) return undefined;
    const handle = setTimeout(() => setGoneNotice(noticeId), BUFFERING_NOTICE_MS);
    return () => clearTimeout(handle);
  }, [noticeId]);
  const shownNotice = bufferingNotice && bufferingNotice.id !== goneNotice ? bufferingNotice : null;

  if (state.kind === 'loading' || state.kind === 'starting') return <LoadingView onExit={onExit} />;

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
    const route = state.plan ? routeOf(state.plan.delivery) : null;
    const details = [
      route ? t(ROUTE_TEXT[route]) : '-',
      playback.mediaError ? String(playback.mediaError.code) : (state.code ?? '-'),
      state.sessionId ? state.sessionId.slice(0, 8) : '-',
    ].join(' · ');
    return (
      <Screen title={title} onBack={onExit} testId="player-error">
        <p role="alert" className="error">
          {t(ERROR_TEXT[state.reason])}
        </p>
        {state.message ? <p>{redact(state.message, [token, state.mediaUrl])}</p> : null}
        {/* The route, the error's code and a short session id: enough to tell a report apart. */}
        <p className="player-error-details" data-testid="player-error-details">
          {redact(details, [token, state.mediaUrl])}
        </p>
        <Button focusKey="player-back" autoFocus onClick={onExit}>
          {t('player.back')}
        </Button>
      </Screen>
    );
  }

  return (
    <>
      <PlayingView
        key={state.loadId}
        plan={state.plan}
        mediaUrl={state.mediaUrl}
        autoplay={state.autoplay}
        heading={state.heading}
        previews={state.previews}
        media={state.media}
        quality={state.quality}
        activeQualityFeature={state.activeQualityFeature}
        panel={panel}
        subtitleDelay={subtitleDelay}
        trackPrefs={trackPrefs}
        started={started}
        onStarted={markStarted}
        contentId={contentId}
        title={title}
        token={token}
        playback={playback}
        neighbours={neighbours}
        postRoll={postRoll}
        ended={ended}
        onPostRoll={enterPostRoll}
        cardCancelled={cancelled}
        onCardCancel={cancelCard}
        leave={leave}
        startEpisode={startEpisode}
      />
      {notice && !postRoll ? (
        <p className="player-notice" role="status" data-testid="player-quality-notice">
          {t('player.menu.quality.unavailable')}
        </p>
      ) : null}
      {shownNotice && !postRoll ? (
        <p className="player-notice" role="status" data-testid="player-buffering-notice">
          {t(
            shownNotice.kind === 'cantLower'
              ? 'player.buffering.cantLower'
              : 'player.buffering.lowered',
          )}
        </p>
      ) : null}
      {postRoll ? (
        <EndScreen
          seriesId={state.media.seriesId}
          seriesTitle={state.heading?.seriesTitle}
          neighbours={neighbours}
          ended={ended}
          // Narrowing only: the screen offers Play now only with a next episode.
          onPlayNext={(byItself) => {
            if (neighbours.next) startEpisode(neighbours.next, byItself);
          }}
          onPlayItem={(item) =>
            startEpisode({ contentId: item.content_id, title: item.title }, false)
          }
          onReturn={returnToPicture}
          onClose={leave}
        />
      ) : null}
    </>
  );
}

/**
 * What answers a click itself: the controls, the open panels and the prompts. Any other click
 * inside the player lands on the picture, whichever layer of the overlay it hit.
 */
const OWN_CLICK =
  'button, [role="slider"], .player-popover, .player-info, .player-buffering, .player-upnext, .dialog-backdrop';

/** The centred spinner both loading views show, so the hand-over from one to the other is invisible. */
function LoadingCue() {
  const t = useT();
  return (
    <p className="player-cue loading" role="status" data-testid="player-cue">
      <span className="spinner" aria-hidden="true" />
      {t('player.loading')}
    </p>
  );
}

/** While the session starts: the black player layer with the cue, as the playing view waits. */
function LoadingView({ onExit }: { onExit: () => void }) {
  // Back leaves, as on any screen.
  useBackHandler(onExit);
  return (
    <div className="player" data-testid="player-loading">
      <LoadingCue />
    </div>
  );
}

function PlayingView({
  plan,
  mediaUrl,
  autoplay,
  heading,
  previews,
  media,
  quality,
  activeQualityFeature,
  panel,
  subtitleDelay,
  trackPrefs,
  started,
  onStarted,
  contentId,
  title,
  token,
  playback,
  neighbours,
  postRoll,
  ended,
  onPostRoll,
  cardCancelled,
  onCardCancel,
  leave,
  startEpisode,
}: {
  plan: Plan;
  mediaUrl: string;
  autoplay: boolean;
  heading: Heading | null;
  previews: PreviewFacts;
  media: MediaFacts;
  quality: string;
  activeQualityFeature: boolean;
  panel: PanelState;
  subtitleDelay: ReturnType<typeof useSubtitleDelay>;
  trackPrefs: TrackPrefWriter;
  started: boolean;
  onStarted(): void;
  contentId: string;
  title: string;
  token: string | undefined;
  playback: PlaybackSession;
  neighbours: EpisodeNeighbours;
  /** The end screen is up: it has the keys, and the corner card and pills give way. */
  postRoll: boolean;
  /** The stream has played to its end: the mini player of the end screen fades out. */
  ended: boolean;
  /** The last 30 s of an episode began. */
  onPostRoll(): void;
  /** The viewer cancelled the credits card for this episode. */
  cardCancelled: boolean;
  onCardCancel(): void;
  leave(): void;
  /** Stops this session and opens an episode in its place; `byItself` for an automatic start. */
  startEpisode(target: { contentId: string; title: string }, byItself: boolean): void;
}) {
  const t = useT();
  const lang = useLanguage();
  const { baseUrl, session } = useSilo();
  const {
    attachEngine,
    reading,
    onLoadedMetadata,
    onPlaying,
    onPause,
    onWaiting,
    onSeeking,
    onEnded,
    onMediaError,
    seekTo,
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
  const skipBack = useProfileSetting('player.video_skip_back_seconds').value;
  const skipForward = useProfileSetting('player.video_skip_forward_seconds').value;
  const timeFormat = useProfileSetting('ui.time_format').value;
  // The device's choice, read when the player opens.
  const [timeMode] = useState(getTimeMode);
  const settings = useProfileSettings();
  // The appearance dialog over the player; the Subtitles menu under it stays open, so the overlay
  // stays up and the video keeps playing.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const knowsAppearance = useServerKnowsSetting('playback.subtitle_appearance');
  const total = plan.source.duration_seconds;
  const popoverOpen = isPopover(panel.open);

  // The menu buttons the playing file has something for, in the order of the row. Audio needs a
  // choice between tracks; Subtitles has the delay besides the tracks, so any subtitle is enough.
  const qualities = useMemo(
    () => qualityMenu(plan, quality, activeQualityFeature),
    [plan, quality, activeQualityFeature],
  );
  const hasSettings = qualities !== null;
  const hasChapters = previews.chapters.length > 0;
  const hasAudio = media.audioTracks.length > 1;
  // A plan that leaves `subtitle` out (the schema requires it; a partial server may not) has none.
  const hasSubtitles = (plan.subtitle?.inventory?.length ?? 0) > 0;
  const menus = useMemo(
    () =>
      MENU_ORDER.filter(
        (id) =>
          id === 'info' ||
          (id === 'audio' && hasAudio) ||
          (id === 'subtitles' && hasSubtitles) ||
          (id === 'chapters' && hasChapters) ||
          (id === 'settings' && hasSettings),
      ),
    [hasAudio, hasSubtitles, hasChapters, hasSettings],
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

  // The episode buttons, as the web player has them: with at least one neighbour both slots are
  // reserved and the missing one is a spacer; with none (a movie, or the season lists not in yet
  // or failed) there are no slots. Only an episode has neighbours: another title of a series
  // (an extra) may carry the series id too.
  const episodes =
    neighbours.previous || neighbours.next
      ? { previous: neighbours.previous !== null, next: neighbours.next !== null }
      : null;
  const openEpisode = (which: 'previous' | 'next') => {
    const target = neighbours[which];
    // Narrowing only: a slot without a neighbour is a spacer, which cannot be pressed.
    if (!target) return;
    startEpisode(target, false);
  };

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
  // The buffering prompt or undo pill takes the skip pill's corner once the skip pill is gone.
  // The credits card takes the corner from the skip pill, as the web's does, and the end screen
  // takes everything.
  const region = useMemo(
    () =>
      autoplayRegion(
        previews.segments,
        duration,
        settings.values['playback.auto_play_next_preview'],
      ),
    [previews.segments, duration, settings.values],
  );
  const card = useUpNextCard({
    enabled: started && !postRoll && !popoverOpen,
    region,
    next: neighbours.next,
    position,
    cancelled: cardCancelled,
    cancel: onCardCancel,
    start: (byItself) => {
      if (neighbours.next) startEpisode(neighbours.next, byItself);
    },
  });
  const skipPill = card.shown || postRoll ? null : skip.pill;
  const skipShowing = skipPill !== null && !popoverOpen;
  const bufferingOffer = playback.buffering.offer;
  const bufferingPill = useBufferingPill({
    offer: bufferingOffer,
    slotFree: started && !skipShowing && !card.shown && !postRoll && !popoverOpen,
    paused,
    answer: playback.bufferingAnswer,
    shown: playback.bufferingShown,
  });
  // The last 30 s of an episode bring up the end screen.
  const lastStretch =
    media.isEpisode &&
    started &&
    duration > 0 &&
    position > 0 &&
    duration - position <= POST_ROLL_SECONDS;
  useEffect(() => {
    if (lastStretch) onPostRoll();
  }, [lastStretch, onPostRoll]);
  const controls = usePlayerControls({
    engine,
    started,
    locked: postRoll,
    paused,
    buffering,
    position,
    duration,
    read: () => reading()?.position ?? null,
    seekTo: (sourceSeconds) => void seekTo(sourceSeconds),
    leave,
    skipBackSeconds: skipBack,
    skipForwardSeconds: skipForward,
    menus,
    episodes,
    onEpisode: openEpisode,
    panel,
    pill: card.shown
      ? {
          shown: true,
          // The card holds the focus for its whole countdown.
          holdsFocus: true,
          activate: card.activate,
          dismiss: card.dismiss,
          move: card.move,
        }
      : skipPill !== null || !bufferingPill.visible
        ? {
            shown: skipPill !== null,
            holdsFocus: skipPill !== null && skip.focusWindow,
            activate: skip.activate,
            dismiss: skip.dismiss,
          }
        : {
            shown: true,
            // The prompt holds the focus for its whole 15 s, not only for the first seconds.
            holdsFocus: true,
            activate: bufferingPill.activate,
            dismiss: () => {
              bufferingPill.dismiss();
              return true;
            },
            move: bufferingPill.move,
          },
  });

  // Back goes through the screen stack like everywhere else; the controls decide what it does.
  useBackHandler(controls.back);

  // Subscribed before the source is set, so no early event is missed.
  const hls = isHlsStream(plan.stream);
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
      engine.on('waiting', () => {
        setShowing(false);
        onWaiting();
      }),
      engine.on('seeking', onSeeking),
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
    // hls.js authenticates with headers read per request; the native fallback needs the token in
    // the URL (a media element cannot send headers), built only if that path is taken.
    engine.setSource(
      mediaUrl,
      hls
        ? {
            hls,
            headers: (url) => authHeadersFor(url, baseUrl, session.get()),
            nativeUrl: () => mediaUrlWithToken(mediaUrl, baseUrl, session.get()?.accessToken),
          }
        : { hls },
    );
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [
    engine,
    mediaUrl,
    hls,
    baseUrl,
    session,
    autoplay,
    reading,
    onStarted,
    onLoadedMetadata,
    onPlaying,
    onPause,
    onWaiting,
    onSeeking,
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
  const trackText: TrackText = {
    unknown: (n) => t('player.menu.track.unknown', { n }),
    audio: t('player.menu.audio.generic'),
    stereo: t('player.menu.audio.stereo'),
    bitDepth: (depth) => t('player.menu.audio.bitDepth', { depth }),
  };
  // Where a pick is remembered: the episode's series, else the movie.
  const prefKey = trackPrefKey(media, contentId);
  let popover = null;
  if (panel.open === 'audio') {
    popover = (
      <AudioMenu
        rows={audioRows(plan, media, lang, trackText)}
        pick={(index) => playback.trackChange(tracksForAudioPick(plan, index), 'audio')}
        save={(index, track) => {
          if (prefKey) void trackPrefs.audio(prefKey, index, track);
        }}
        onApplied={() => panel.finish('audio')}
        remember={panel.remember}
        recall={panel.recall}
        onSide={controls.menuSide}
      />
    );
  } else if (panel.open === 'subtitles') {
    popover = (
      <SubtitlesMenu
        rows={subtitleRows(plan, lang, trackText)}
        offChecked={plan.selected_tracks.subtitle === undefined}
        delayMs={subtitleDelay.delayMs}
        pick={(item) => playback.trackChange(tracksForSubtitlePick(plan, item), 'subtitle')}
        save={(item) => {
          if (prefKey) void trackPrefs.subtitle(prefKey, item);
        }}
        onDelay={subtitleDelay.nudge}
        onDelayReset={subtitleDelay.reset}
        onApplied={() => panel.finish('subtitles')}
        onAppearance={knowsAppearance ? () => setAppearanceOpen(true) : undefined}
        remember={panel.remember}
        recall={panel.recall}
        onSide={controls.menuSide}
      />
    );
  } else if (panel.open === 'settings' && qualities) {
    popover = (
      <SettingsMenu
        menu={qualities}
        preference={quality}
        qualityChange={playback.qualityChange}
        onApplied={() => panel.finish('settings')}
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
    <div
      className="player"
      data-testid="player"
      // The end screen shrinks the picture into its mini player; the stream's end fades it out.
      data-end={postRoll ? (ended ? 'ended' : 'mini') : undefined}
      onMouseMove={controls.pointerMoved}
      onClick={(e) => {
        if (!(e.target instanceof Element) || e.target.closest(OWN_CLICK)) return;
        controls.pictureClicked();
      }}
    >
      {postRoll ? (
        <EndBackdrop
          thumbhash={
            neighbours.nextEntry !== null &&
            !protectsEpisodeStill(neighbours.nextEntry, {
              images: settings.values['catalog.hide_unwatched_episode_images'],
              overviews: settings.values['catalog.hide_unwatched_episode_overviews'],
            })
              ? neighbours.nextEntry.still_thumbhash
              : undefined
          }
        />
      ) : null}
      <video ref={setRef} className="player-video" preload="auto" autoPlay={autoplay} />
      {cue && !postRoll ? <LoadingCue /> : null}
      {postRoll ? null : (
        <PlayerSubtitles
          plan={plan}
          position={position}
          lifted={controls.visible}
          offsetMs={subtitleDelay.delayMs}
        />
      )}
      <PlayerOsd
        visible={controls.visible && !postRoll}
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
        segments={previews.segments}
        previews={trickplay}
        menus={menus}
        episodes={episodes}
        subtitlesOn={plan.selected_tracks.subtitle !== undefined}
        openMenu={panel.open}
        qualityText={qualityText}
        timeMode={timeMode}
        timeFormat={timeFormat}
        popover={popover}
        info={
          panel.open === 'info' ? (
            <InfoColumn
              plan={plan}
              media={media}
              video={video}
              engine={engine}
              qualityName={qualityInUse?.kind === 'name' ? qualityInUse.name : quality}
              bandwidthCapKbps={settings.values['playback.max_bitrate_kbps']}
              mediaError={mediaError}
              secrets={[mediaUrl, token]}
            />
          ) : null
        }
        onFocus={controls.setFocus}
        onSeekFraction={controls.seekToFraction}
        onAction={controls.action}
      />
      {appearanceOpen ? (
        <SubtitleAppearanceDialog onClose={() => setAppearanceOpen(false)} />
      ) : null}
      {bufferingOffer && bufferingPill.visible ? (
        <BufferingPill
          offer={bufferingOffer}
          focused={controls.focus === 'pill'}
          choice={bufferingPill.choice}
          raised={controls.visible}
          running={bufferingPill.running}
          elapsedMs={bufferingPill.elapsedMs}
          onLower={bufferingPill.lower}
          onKeep={bufferingPill.keep}
          onRestore={bufferingPill.restore}
          onFocus={(choice) => {
            bufferingPill.setChoice(choice);
            controls.setFocus('pill');
          }}
        />
      ) : null}
      {card.shown && neighbours.next ? (
        <UpNextCard
          next={neighbours.next}
          entry={neighbours.nextEntry}
          protectStill={
            neighbours.nextEntry !== null &&
            protectsEpisodeStill(neighbours.nextEntry, {
              images: settings.values['catalog.hide_unwatched_episode_images'],
              overviews: settings.values['catalog.hide_unwatched_episode_overviews'],
            })
          }
          seconds={card.seconds}
          focused={controls.focus === 'pill'}
          choice={card.choice}
          raised={controls.visible}
          onPlay={card.playNow}
          onCancel={card.cancelCard}
          onFocus={(choice) => {
            card.setChoice(choice);
            controls.setFocus('pill');
          }}
        />
      ) : null}
      {skipPill && !popoverOpen ? (
        <SkipPillButton
          pill={skipPill}
          focused={controls.focus === 'pill'}
          filling={skip.focusWindow}
          raised={controls.visible}
          onActivate={skip.activate}
          onFocus={() => controls.setFocus('pill')}
        />
      ) : null}
    </div>
  );
}
