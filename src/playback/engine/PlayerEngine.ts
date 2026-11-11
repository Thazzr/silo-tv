// The thin seam between the playback logic and whatever actually decodes the media. webOS and the
// browser use the HTML <video> element (HtmlVideoEngine); a Tizen AVPlay engine joins in Phase 6.
// Screens and the session controller talk to this interface only.

export interface TimeRange {
  start: number;
  end: number;
}

export interface EngineError {
  /** MediaError codes: 1 aborted, 2 network, 3 decode, 4 source not supported. */
  code: number;
  message: string;
}

export type EngineEvent =
  | 'loadedmetadata'
  | 'loadeddata'
  | 'timeupdate'
  | 'playing'
  | 'pause'
  | 'waiting'
  | 'seeking'
  | 'seeked'
  /** Media data arrived: a range or segment was received, or the buffer grew. Not subtitles. */
  | 'data'
  | 'ended'
  | 'error';

export interface SourceOptions {
  /** The plan says the stream is HLS (protocol or MIME type), so an engine can pick its HLS path. */
  hls: boolean;
  /**
   * Headers for a request the engine makes itself (hls.js playlists, keys and segments), computed
   * per request URL and read at request time, so a refreshed token applies to the next request.
   * Empty for a URL the account token must not go to. Never used for the element's own loads.
   */
  headers?: (url: string) => Record<string, string>;
  /**
   * The source URL with the token in it, for when the stream plays through the element's own
   * player: a media element cannot send headers. Computed only on that path, so the token never
   * enters a URL hls.js uses. Without it the plain URL is used.
   */
  nativeUrl?: () => string;
}

/** Whether the plan's stream is HLS; from the plan's own facts, never from the URL. */
export function isHlsStream(stream: { protocol: string; mime_type?: string }): boolean {
  return (
    stream.protocol === 'hls' || stream.mime_type?.toLowerCase() === 'application/vnd.apple.mpegurl'
  );
}

export interface PlayerEngine {
  /** Loads another source; playback starts by itself where the host allows autoplay. */
  setSource(url: string, options: SourceOptions): void;
  /** Never rejects: an autoplay refusal is not a failure the caller can act on. */
  play(): Promise<void>;
  pause(): void;
  /** Moves the playhead to a position on the engine's own timeline, in seconds. */
  seek(seconds: number): void;
  /** Seconds on the engine's own timeline (for Matroska in Chromium that has a container origin). */
  readonly currentTime: number;
  /** NaN while unknown. */
  readonly duration: number;
  readonly seekable: TimeRange[];
  readonly buffered: TimeRange[];
  playbackRate: number;
  readonly paused: boolean;
  readonly ended: boolean;
  /** True from a stall until the next frame plays. */
  readonly waiting: boolean;
  /** The element has data for the next frame (readyState HAVE_FUTURE_DATA or more). */
  readonly hasFutureData: boolean;
  readonly error: EngineError | null;
  /** Which path decodes the source: the element's own player, or hls.js over MediaSource. */
  readonly decoder: 'native' | 'hlsjs';
  /** What hls.js estimates the connection carries, in bit/s; null off hls.js or before a reading. */
  readonly bandwidthEstimate: number | null;
  /** Subscribes to an event; returns the function that unsubscribes. */
  on(event: EngineEvent, handler: () => void): () => void;
  /** Detaches every listener and frees the decoder. The engine is unusable afterwards; repeating it is harmless. */
  release(): void;
}
