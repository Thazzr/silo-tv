// jsdom has no media pipeline: its HTMLMediaElement methods are stubs that log errors. This helper
// replaces the members the player uses with a scriptable state per element.
import { vi } from 'vitest';

export interface FakeVideoState {
  paused: boolean;
  currentTime: number;
  duration: number;
  ended: boolean;
  error: { code: number; message: string } | null;
  videoWidth: number;
  videoHeight: number;
  playbackRate: number;
  readyState: number;
  networkState: number;
  bufferedEnd: number;
  /** The seekable ranges as [start, end] pairs. */
  seekable: [number, number][];
  /** Every value the player assigned to currentTime. */
  seeks: number[];
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

const states = new WeakMap<HTMLMediaElement, FakeVideoState>();

export function fakeVideo(el: HTMLMediaElement): FakeVideoState {
  let state = states.get(el);
  if (!state) {
    const created: FakeVideoState = {
      paused: true,
      currentTime: 0,
      duration: Number.NaN,
      ended: false,
      error: null,
      videoWidth: 0,
      videoHeight: 0,
      playbackRate: 1,
      readyState: 0,
      networkState: 0,
      bufferedEnd: 0,
      seekable: [],
      seeks: [],
      play: vi.fn(() => {
        created.paused = false;
        el.dispatchEvent(new Event('play'));
        return Promise.resolve();
      }),
      pause: vi.fn(() => {
        created.paused = true;
        el.dispatchEvent(new Event('pause'));
      }),
    };
    state = created;
    states.set(el, state);
  }
  return state;
}

const MEMBERS = [
  'paused',
  'duration',
  'ended',
  'error',
  'readyState',
  'networkState',
  'playbackRate',
  'currentTime',
  'buffered',
  'seekable',
  'play',
  'pause',
] as const;

type Saved = Map<string, PropertyDescriptor | undefined>;

/** Installs the fake members on the prototypes; the returned function restores jsdom's own. */
export function installFakeMedia(): () => void {
  const media = HTMLMediaElement.prototype;
  const video = HTMLVideoElement.prototype;
  const saved: Saved = new Map();
  const define = (target: object, name: string, descriptor: PropertyDescriptor) => {
    saved.set(
      `${target === media ? 'media' : 'video'}.${name}`,
      Object.getOwnPropertyDescriptor(target, name),
    );
    Object.defineProperty(target, name, { configurable: true, ...descriptor });
  };
  const read = <K extends keyof FakeVideoState>(key: K) =>
    function (this: HTMLMediaElement) {
      return fakeVideo(this)[key];
    };

  for (const name of MEMBERS) {
    if (name === 'currentTime') {
      define(media, name, {
        get() {
          return fakeVideo(this as HTMLMediaElement).currentTime;
        },
        set(value: number) {
          const state = fakeVideo(this as HTMLMediaElement);
          state.currentTime = value;
          state.seeks.push(value);
        },
      });
    } else if (name === 'buffered') {
      define(media, name, {
        get() {
          const end = fakeVideo(this as HTMLMediaElement).bufferedEnd;
          return { length: end > 0 ? 1 : 0, start: () => 0, end: () => end };
        },
      });
    } else if (name === 'seekable') {
      define(media, name, {
        get() {
          const ranges = fakeVideo(this as HTMLMediaElement).seekable;
          return {
            length: ranges.length,
            start: (i: number) => ranges[i]![0],
            end: (i: number) => ranges[i]![1],
          };
        },
      });
    } else if (name === 'play' || name === 'pause') {
      define(media, name, {
        value(this: HTMLMediaElement) {
          return (fakeVideo(this)[name] as (...args: unknown[]) => unknown)();
        },
      });
    } else if (name === 'error') {
      define(media, name, { get: read('error') });
    } else {
      define(media, name, { get: read(name) });
    }
  }
  define(video, 'videoWidth', { get: read('videoWidth') });
  define(video, 'videoHeight', { get: read('videoHeight') });

  return () => {
    for (const [key, descriptor] of saved) {
      const [kind, name] = key.split('.') as ['media' | 'video', string];
      const target = kind === 'media' ? media : video;
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete (target as unknown as Record<string, unknown>)[name];
    }
  };
}
