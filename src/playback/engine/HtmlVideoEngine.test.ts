import { describe, expect, it, vi } from 'vitest';
import { HtmlVideoEngine } from './HtmlVideoEngine';

function ranges(list: [number, number][]) {
  return {
    length: list.length,
    start: (i: number) => list[i]![0],
    end: (i: number) => list[i]![1],
  };
}

/** The members of an HTML video element the engine touches, with the real event plumbing. */
class FakeElement extends EventTarget {
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = Number.NaN;
  playbackRate = 1;
  error: { code: number; message: string } | null = null;
  seekable = ranges([]);
  buffered = ranges([]);
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
}

function setup() {
  const el = new FakeElement();
  return { el, engine: new HtmlVideoEngine(el as unknown as HTMLVideoElement) };
}

describe('HtmlVideoEngine', () => {
  it('forwards the source, play, pause, seek and the playback rate to the element', async () => {
    const { el, engine } = setup();
    engine.setSource('https://media.example/stream', { hls: false });
    expect(el.src).toBe('https://media.example/stream');
    await engine.play();
    expect(el.play).toHaveBeenCalledTimes(1);
    engine.pause();
    expect(el.pause).toHaveBeenCalledTimes(1);
    engine.seek(42.5);
    expect(el.currentTime).toBe(42.5);
    engine.playbackRate = 1.5;
    expect(el.playbackRate).toBe(1.5);
    expect(engine.playbackRate).toBe(1.5);
  });

  it('does not reject when the element refuses to play', async () => {
    const { el, engine } = setup();
    el.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(engine.play()).resolves.toBeUndefined();
  });

  it('reads the state of the element', () => {
    const { el, engine } = setup();
    el.currentTime = 12;
    el.duration = 100;
    el.paused = false;
    el.ended = true;
    el.seekable = ranges([
      [0, 30],
      [60, 90],
    ]);
    el.buffered = ranges([[5, 20]]);
    el.error = { code: 3, message: 'decode' };
    expect(engine.currentTime).toBe(12);
    expect(engine.duration).toBe(100);
    expect(engine.paused).toBe(false);
    expect(engine.ended).toBe(true);
    expect(engine.seekable).toEqual([
      { start: 0, end: 30 },
      { start: 60, end: 90 },
    ]);
    expect(engine.buffered).toEqual([{ start: 5, end: 20 }]);
    expect(engine.error).toEqual({ code: 3, message: 'decode' });
    el.error = null;
    expect(engine.error).toBeNull();
  });

  it('forwards the element events until the subscription ends', () => {
    const { el, engine } = setup();
    const names = [
      'loadedmetadata',
      'loadeddata',
      'timeupdate',
      'playing',
      'pause',
      'waiting',
      'ended',
      'error',
    ];
    const seen: string[] = [];
    const offs = names.map((name) =>
      engine.on(name as Parameters<typeof engine.on>[0], () => seen.push(name)),
    );
    for (const name of names) el.dispatchEvent(new Event(name));
    expect(seen).toEqual(names);
    offs.forEach((off) => off());
    el.dispatchEvent(new Event('playing'));
    expect(seen).toHaveLength(names.length);
  });

  it('is waiting from a stall until the next frame plays', () => {
    const { el, engine } = setup();
    expect(engine.waiting).toBe(false);
    el.dispatchEvent(new Event('waiting'));
    expect(engine.waiting).toBe(true);
    el.dispatchEvent(new Event('playing'));
    expect(engine.waiting).toBe(false);
  });

  it('releases the element: no more events, no source', () => {
    const { el, engine } = setup();
    const handler = vi.fn();
    engine.on('playing', handler);
    engine.setSource('https://media.example/stream', { hls: false });
    engine.release();
    el.dispatchEvent(new Event('playing'));
    expect(handler).not.toHaveBeenCalled();
    expect(el.src).toBe('');
    expect(el.load).toHaveBeenCalledTimes(1);
    // The internal waiting tracker is gone as well.
    el.dispatchEvent(new Event('waiting'));
    expect(engine.waiting).toBe(false);
  });

  it('releases once: a second release neither unloads the element again nor touches its listeners', () => {
    const { el, engine } = setup();
    engine.on('playing', vi.fn());
    const removeListener = vi.spyOn(el, 'removeEventListener');
    engine.release();
    const removed = removeListener.mock.calls.length;
    expect(removed).toBeGreaterThan(0);
    engine.release();
    expect(el.load).toHaveBeenCalledTimes(1);
    expect(el.removeAttribute).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(removed);
  });
});
