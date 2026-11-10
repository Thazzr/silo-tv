import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no MSE, so hls.js is replaced by a recording stand-in with the same surface.
const mock = vi.hoisted(() => {
  type Handler = (event: string, data: Record<string, unknown>) => void;
  class FakeHls {
    static supported = true;
    static instances: FakeHls[] = [];
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: 'hlsError' };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
      OTHER_ERROR: 'otherError',
    };
    handlers: Handler[] = [];
    config: unknown;
    attachMedia = vi.fn();
    loadSource = vi.fn();
    detachMedia = vi.fn();
    destroy = vi.fn();
    constructor(config: unknown) {
      this.config = config;
      FakeHls.instances.push(this);
    }
    on(_name: string, handler: Handler) {
      this.handlers.push(handler);
    }
    fail(data: Record<string, unknown>) {
      for (const handler of this.handlers) handler('hlsError', data);
    }
  }
  return { FakeHls };
});

vi.mock('hls.js', () => ({ default: mock.FakeHls }));

import { HtmlVideoEngine } from './HtmlVideoEngine';

const { FakeHls } = mock;
const URL = 'https://media.example/api/v2/stream/x/index.m3u8?st=abc';

class FakeElement extends EventTarget {
  src = '';
  error: { code: number; message: string } | null = null;
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
}

function setup() {
  const el = new FakeElement();
  return { el, engine: new HtmlVideoEngine(el as unknown as HTMLVideoElement) };
}

beforeEach(() => {
  FakeHls.supported = true;
  FakeHls.instances = [];
});

describe('HtmlVideoEngine source path', () => {
  it('plays HLS through hls.js with the exact URL and leaves el.src alone', () => {
    const { el, engine } = setup();
    engine.setSource(URL, { hls: true });
    expect(FakeHls.instances).toHaveLength(1);
    const hls = FakeHls.instances[0]!;
    expect(hls.attachMedia).toHaveBeenCalledWith(el);
    expect(hls.loadSource).toHaveBeenCalledWith(URL);
    expect(el.src).toBe('');
    expect(hls.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
      backBufferLength: 30,
    });
    // The element is attached before the source loads.
    expect(hls.attachMedia.mock.invocationCallOrder[0]!).toBeLessThan(
      hls.loadSource.mock.invocationCallOrder[0]!,
    );
  });

  it('uses the native source for HLS when hls.js is not supported', () => {
    FakeHls.supported = false;
    const { el, engine } = setup();
    engine.setSource(URL, { hls: true });
    expect(FakeHls.instances).toHaveLength(0);
    expect(el.src).toBe(URL);
  });

  it('uses the native source for a progressive file and creates no Hls', () => {
    const { el, engine } = setup();
    engine.setSource('https://media.example/file.mkv', { hls: false });
    expect(FakeHls.instances).toHaveLength(0);
    expect(el.src).toBe('https://media.example/file.mkv');
  });

  it('destroys the previous instance when the source changes', () => {
    const { el, engine } = setup();
    engine.setSource(URL, { hls: true });
    engine.setSource('https://media.example/file.mp4', { hls: false });
    expect(FakeHls.instances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(el.src).toBe('https://media.example/file.mp4');
  });
});

describe('HtmlVideoEngine hls.js errors', () => {
  it('reports a fatal network error once, as code 2', () => {
    const { engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    const hls = FakeHls.instances[0]!;
    hls.fail({ fatal: true, type: 'networkError', details: 'manifestLoadError' });
    hls.fail({ fatal: true, type: 'networkError', details: 'fragLoadError' });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(engine.error?.code).toBe(2);
  });

  it('maps a fatal media error to 3 and any other fatal error to 4', () => {
    const media = setup();
    media.engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.fail({ fatal: true, type: 'mediaError', details: 'x' });
    expect(media.engine.error?.code).toBe(3);
    const other = setup();
    other.engine.setSource(URL, { hls: true });
    FakeHls.instances[1]!.fail({ fatal: true, type: 'otherError', details: 'x' });
    expect(other.engine.error?.code).toBe(4);
  });

  it('ignores a non-fatal error', () => {
    const { engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.fail({ fatal: false, type: 'networkError', details: 'fragLoadError' });
    expect(seen).not.toHaveBeenCalled();
    expect(engine.error).toBeNull();
  });

  it('does not report an element error that follows the fatal hls.js one', () => {
    const { el, engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.fail({ fatal: true, type: 'mediaError', details: 'x' });
    el.dispatchEvent(new Event('error'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still forwards an element error on its own', () => {
    const { el, engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    el.error = { code: 3, message: 'decode' };
    el.dispatchEvent(new Event('error'));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(engine.error).toEqual({ code: 3, message: 'decode' });
  });
});

describe('stale state after a source change', () => {
  it('clears the error on the next source and reports a new fatal error again', () => {
    const { engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.fail({ fatal: true, type: 'networkError', details: 'x' });
    expect(engine.error?.code).toBe(2);
    engine.setSource(URL, { hls: true });
    expect(engine.error).toBeNull();
    FakeHls.instances[1]!.fail({ fatal: true, type: 'mediaError', details: 'y' });
    expect(seen).toHaveBeenCalledTimes(2);
    expect(engine.error?.code).toBe(3);
  });

  it('ignores a late fatal error of the old instance', () => {
    const { engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.fail({ fatal: true, type: 'networkError', details: 'late' });
    expect(seen).not.toHaveBeenCalled();
    expect(engine.error).toBeNull();
  });
});

describe('HtmlVideoEngine release with hls.js', () => {
  it('detaches and destroys the instance, then unloads the element, and only once', () => {
    const { el, engine } = setup();
    engine.setSource(URL, { hls: true });
    const hls = FakeHls.instances[0]!;
    engine.release();
    const at = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(at(hls.detachMedia)).toBeLessThan(at(hls.destroy));
    expect(at(hls.destroy)).toBeLessThan(at(el.removeAttribute));
    expect(at(el.removeAttribute)).toBeLessThan(at(el.load));
    expect(el.removeAttribute).toHaveBeenCalledWith('src');
    engine.release();
    expect(hls.detachMedia).toHaveBeenCalledTimes(1);
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it('lets no error of the destroyed instance reach the engine', () => {
    const { engine } = setup();
    const seen = vi.fn();
    engine.on('error', seen);
    engine.setSource(URL, { hls: true });
    engine.release();
    FakeHls.instances[0]!.fail({ fatal: true, type: 'networkError', details: 'late' });
    expect(seen).not.toHaveBeenCalled();
    expect(engine.error).toBeNull();
  });
});
