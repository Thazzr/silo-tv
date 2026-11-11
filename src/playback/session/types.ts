// The types the playback session's modules and the screens share. Constants live next to the
// module that uses them.
import type { components } from '../../api/generated/schema';
import type { Chapter } from '../osd/previewMath';
import type { Segment } from '../skip/segments';

export type S = components['schemas'];
export type Plan = S['PlaybackPlan'];
export type SelectedTracks = S['SelectedTracksV3'];
export type ReplanOperation = NonNullable<S['PlaybackReplanBody']['operation']>;

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
  /** The buffering controller's lowering on Auto: the step-down estimate and what was measured. */
  lowering?: { estimateKbps: number; observedKbps: number | null };
  /** The buffering controller's undo: back to Auto, the learned limit cleared. */
  restore?: boolean;
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

/** Thrown inside a start's preparation; the controller turns it into the failure it names. */
export class SessionError extends Error {
  constructor(readonly reason: SessionFailure) {
    super(reason);
  }
}
