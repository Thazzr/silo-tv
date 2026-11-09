import type { EngineError, EngineEvent, PlayerEngine, TimeRange } from './PlayerEngine';

function ranges(list: TimeRanges): TimeRange[] {
  const out: TimeRange[] = [];
  for (let i = 0; i < list.length; i += 1) out.push({ start: list.start(i), end: list.end(i) });
  return out;
}

/** PlayerEngine over an HTML video element: what webOS and the browser play with. */
export class HtmlVideoEngine implements PlayerEngine {
  private readonly subscriptions = new Set<() => void>();
  private stalled = false;

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

  setSource(url: string): void {
    this.el.src = url;
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
    const error = this.el.error;
    return error ? { code: error.code, message: error.message } : null;
  }

  on(event: EngineEvent, handler: () => void): () => void {
    return this.subscribe(event, handler);
  }

  release(): void {
    for (const off of [...this.subscriptions]) off();
    // Without a source the element drops its decoder; the screen removes the element itself.
    this.el.removeAttribute('src');
    try {
      this.el.load();
    } catch {
      // A host without a media pipeline (tests) has nothing to free.
    }
  }
}
