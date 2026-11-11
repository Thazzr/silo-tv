import Hls from 'hls.js';
import type {
  EngineError,
  EngineEvent,
  PlayerEngine,
  SourceOptions,
  TimeRange,
} from './PlayerEngine';

function ranges(list: TimeRanges): TimeRange[] {
  const out: TimeRange[] = [];
  for (let i = 0; i < list.length; i += 1) out.push({ start: list.start(i), end: list.end(i) });
  return out;
}

/** PlayerEngine over an HTML video element: what webOS and the browser play with. */
export class HtmlVideoEngine implements PlayerEngine {
  private readonly subscriptions = new Set<() => void>();
  private stalled = false;
  private released = false;
  private hls: Hls | null = null;
  /** The fatal hls.js error of the current source; the element itself has none to report. */
  private hlsError: EngineError | null = null;
  private readonly errorHandlers = new Set<() => void>();
  private readonly dataHandlers = new Set<() => void>();

  constructor(private readonly el: HTMLVideoElement) {
    // The element has no "waiting" state of its own that matches the events, so track it here.
    this.subscribe('waiting', () => (this.stalled = true));
    this.subscribe('playing', () => (this.stalled = false));
    this.subscribe('emptied', () => (this.stalled = false));
  }

  private subscribe(name: string, handler: () => void): () => void {
    this.el.addEventListener(name, handler);
    const off = () => {
      this.el.removeEventListener(name, handler);
      this.subscriptions.delete(off);
    };
    this.subscriptions.add(off);
    return off;
  }

  setSource(url: string, options: SourceOptions): void {
    this.destroyHls();
    this.hlsError = null;
    // Server HLS can use EXT-X-DEFINE, which webOS's native player rejects; hls.js over MSE
    // handles it. The URL is opaque and goes to hls.js untouched; its requests authenticate with
    // headers, so the URL carries no token.
    if (options.hls && Hls.isSupported()) {
      const headersFor = options.headers;
      const hls = new Hls({
        enableWorker: true, // hls.js falls back to the main thread when a worker cannot start
        lowLatencyMode: false,
        maxBufferLength: 30,
        backBufferLength: 30,
        // Runs for every playlist, key and segment request, so each one carries the current token.
        ...(headersFor
          ? {
              xhrSetup: (xhr: XMLHttpRequest, requestUrl: string) => {
                const headers = headersFor(requestUrl);
                for (const name of Object.keys(headers)) xhr.setRequestHeader(name, headers[name]!);
              },
            }
          : {}),
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Non-fatal errors are hls.js's own to recover from.
        if (!data.fatal || this.hls !== hls || this.hlsError) return;
        const code =
          data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? 2
            : data.type === Hls.ErrorTypes.MEDIA_ERROR
              ? 3
              : 4;
        this.hlsError = { code, message: `hls.js ${data.type}: ${data.details}` };
        for (const handler of [...this.errorHandlers]) handler();
      });
      // A loaded fragment is media data arriving (playlists and keys are not).
      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (this.hls === hls) for (const handler of [...this.dataHandlers]) handler();
      });
      this.hls = hls;
      hls.attachMedia(this.el);
      hls.loadSource(url);
      return;
    }
    // The element's own player cannot send headers: HLS that falls back to it needs the token URL.
    this.el.src = options.hls && options.nativeUrl ? options.nativeUrl() : url;
  }

  private destroyHls(): void {
    const hls = this.hls;
    if (!hls) return;
    this.hls = null;
    hls.detachMedia();
    hls.destroy();
  }

  play(): Promise<void> {
    return Promise.resolve(this.el.play()).catch(() => undefined);
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    this.el.currentTime = seconds;
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get duration(): number {
    return this.el.duration;
  }

  get seekable(): TimeRange[] {
    return ranges(this.el.seekable);
  }

  get buffered(): TimeRange[] {
    return ranges(this.el.buffered);
  }

  get playbackRate(): number {
    return this.el.playbackRate;
  }

  set playbackRate(rate: number) {
    this.el.playbackRate = rate;
  }

  get paused(): boolean {
    return this.el.paused;
  }

  get ended(): boolean {
    return this.el.ended;
  }

  get waiting(): boolean {
    return this.stalled;
  }

  get error(): EngineError | null {
    if (this.hlsError) return this.hlsError;
    const error = this.el.error;
    return error ? { code: error.code, message: error.message } : null;
  }

  get hasFutureData(): boolean {
    return this.el.readyState >= 3;
  }

  get decoder(): 'native' | 'hlsjs' {
    return this.hls ? 'hlsjs' : 'native';
  }

  get bandwidthEstimate(): number | null {
    const estimate = this.hls?.bandwidthEstimate;
    return typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0
      ? estimate
      : null;
  }

  on(event: EngineEvent, handler: () => void): () => void {
    if (event === 'data') {
      // The element's own progress covers direct play and the buffer growing under hls.js; hls.js
      // adds each loaded fragment.
      const offProgress = this.subscribe('progress', handler);
      this.dataHandlers.add(handler);
      return () => {
        offProgress();
        this.dataHandlers.delete(handler);
      };
    }
    if (event !== 'error') return this.subscribe(event, handler);
    // A fatal hls.js error is reported once; an element error that follows it is the same failure.
    const offElement = this.subscribe('error', () => {
      if (!this.hlsError) handler();
    });
    this.errorHandlers.add(handler);
    return () => {
      offElement();
      this.errorHandlers.delete(handler);
    };
  }

  release(): void {
    // The controller unloads on stop and the screen's cleanup does it again: once is enough.
    if (this.released) return;
    this.released = true;
    for (const off of [...this.subscriptions]) off();
    this.errorHandlers.clear();
    this.dataHandlers.clear();
    // Before the unload below, so hls.js lets go of the element and its MediaSource first.
    this.destroyHls();
    // Without a source the element drops its decoder; the screen removes the element itself.
    this.el.removeAttribute('src');
    try {
      this.el.load();
    } catch {
      // A host without a media pipeline (tests) has nothing to free.
    }
  }
}
