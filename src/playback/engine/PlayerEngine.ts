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
  | 'ended'
  | 'error';

export interface SourceOptions {
  /** The plan says the stream is HLS (protocol or MIME type), so an engine can pick its HLS path. */
  hls: boolean;
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
  readonly error: EngineError | null;
  /** Subscribes to an event; returns the function that unsubscribes. */
  on(event: EngineEvent, handler: () => void): () => void;
  /** Detaches every listener and frees the decoder. The engine is unusable afterwards; repeating it is harmless. */
  release(): void;
}
