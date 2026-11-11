// A scriptable PlayerEngine for the controller tests: the state is plain fields, every call is
// recorded, and emit() plays the part of the media pipeline.
import { vi } from 'vitest';
import type {
  EngineError,
  EngineEvent,
  PlayerEngine,
  SourceOptions,
  TimeRange,
} from '../playback/engine/PlayerEngine';

export class FakeEngine implements PlayerEngine {
  currentTime = 0;
  duration = Number.NaN;
  seekable: TimeRange[] = [];
  buffered: TimeRange[] = [];
  playbackRate = 1;
  paused = true;
  ended = false;
  waiting = false;
  hasFutureData = true;
  error: EngineError | null = null;
  decoder: 'native' | 'hlsjs' = 'native';
  bandwidthEstimate: number | null = null;
  source = '';
  released = false;
  /** Every position the controller seeked to. */
  seeks: number[] = [];
  readonly play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  private readonly handlers = new Map<EngineEvent, Set<() => void>>();

  /** The `hls` flag of the last setSource call. */
  sourceIsHls = false;
  /** The options of the last setSource call. */
  sourceOptions: SourceOptions = { hls: false };

  setSource(url: string, options: SourceOptions = { hls: false }): void {
    this.source = url;
    this.sourceIsHls = options.hls;
    this.sourceOptions = options;
  }

  seek(seconds: number): void {
    this.seeks.push(seconds);
    this.currentTime = seconds;
  }

  on(event: EngineEvent, handler: () => void): () => void {
    const set = this.handlers.get(event) ?? new Set<() => void>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => void set.delete(handler);
  }

  emit(event: EngineEvent): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler();
  }

  release(): void {
    this.released = true;
    this.handlers.clear();
  }
}
