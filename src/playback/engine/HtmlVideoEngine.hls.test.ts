import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no MSE, so hls.js is replaced by a recording stand-in with the same surface.
const mock = vi.hoisted(() => {
  type Handler = (event: string, data: Record<string, unknown>) => void;
  class FakeHls {
    static supported = true;
    static instances: FakeHls[] = [];
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: 'hlsError', FRAG_LOADED: 'hlsFragLoaded' };
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
      OTHER_ERROR: 'otherError',
    };
    handlers: Handler[] = [];
    loadedHandlers: Handler[] = [];
    config: unknown;
    bandwidthEstimate = Number.NaN;
    attachMedia = vi.fn();
    loadSource = vi.fn();
    detachMedia = vi.fn();
    destroy = vi.fn();
    constructor(config: unknown) {
      this.config = config;
      FakeHls.instances.push(this);
    }
    on(name: string, handler: Handler) {
      if (name === 'hlsFragLoaded') this.loadedHandlers.push(handler);
      else this.handlers.push(handler);
    }
    loadFragment() {
      for (const handler of this.loadedHandlers) handler('hlsFragLoaded', {});
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

describe('HtmlVideoEngine authentication', () => {
  type XhrSetup = (xhr: XMLHttpRequest, url: string) => void;
  const SERVER = 'https://media.example';

  /** An XHR stand-in that records the headers set on it. */
  function recordingXhr() {
    const headers: Record<string, string> = {};
    const xhr = {
      setRequestHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as XMLHttpRequest;
    return { xhr, headers };
  }

  function xhrSetupOf(hls: InstanceType<typeof FakeHls>): XhrSetup {
    return (hls.config as { xhrSetup: XhrSetup }).xhrSetup;
  }

  it('sets the headers on hls.js requests, per request URL and only where the callback allows', () => {
    const { engine } = setup();
    let token = 'first';
    engine.setSource(URL, {
      hls: true,
      headers: (url): Record<string, string> =>
        url.startsWith(SERVER) ? { Authorization: `Bearer ${token}`, 'X-Profile-Id': 'p1' } : {},
    });
    const setupXhr = xhrSetupOf(FakeHls.instances[0]!);

    const own = recordingXhr();
    setupXhr(own.xhr, `${SERVER}/api/v2/stream/x/seg1.ts`);
    expect(own.headers).toEqual({ Authorization: 'Bearer first', 'X-Profile-Id': 'p1' });

    // Read at request time: a refreshed token applies to the next request, no reload.
    token = 'second';
    const next = recordingXhr();
    setupXhr(next.xhr, `${SERVER}/api/v2/stream/x/seg2.ts`);
    expect(next.headers.Authorization).toBe('Bearer second');
    expect(FakeHls.instances).toHaveLength(1);

    const other = recordingXhr();
    setupXhr(other.xhr, 'https://node.example/seg3.ts');
    expect(other.headers).toEqual({});
  });

  it('gives hls.js the URL it was handed, with no token added', () => {
    const { engine } = setup();
    engine.setSource(URL, {
      hls: true,
      headers: () => ({ Authorization: 'Bearer secret-fake' }),
      nativeUrl: () => `${URL}&token=secret-fake`,
    });
    expect(FakeHls.instances[0]!.loadSource).toHaveBeenCalledWith(URL);
    expect(JSON.stringify(FakeHls.instances[0]!.loadSource.mock.calls)).not.toContain('token=');
  });

  it('adds no xhrSetup when there are no headers to send', () => {
    const { engine } = setup();
    engine.setSource(URL, { hls: true });
    expect(FakeHls.instances[0]!.config).not.toHaveProperty('xhrSetup');
  });

  it('falls back to the token URL on the element when hls.js is not supported', () => {
    FakeHls.supported = false;
    const { el, engine } = setup();
    const nativeUrl = vi.fn(() => `${URL}&token=secret-fake`);
    engine.setSource(URL, { hls: true, headers: () => ({}), nativeUrl });
    expect(el.src).toBe(`${URL}&token=secret-fake`);
  });

  it('never asks for the token URL while hls.js plays, nor for a progressive file', () => {
    const { el, engine } = setup();
    const nativeUrl = vi.fn(() => `${URL}&token=secret-fake`);
    engine.setSource(URL, { hls: true, nativeUrl });
    expect(nativeUrl).not.toHaveBeenCalled();
    engine.setSource('https://media.example/file.mkv', { hls: false, nativeUrl });
    expect(nativeUrl).not.toHaveBeenCalled();
    expect(el.src).toBe('https://media.example/file.mkv');
  });
});

describe('HtmlVideoEngine decoder and bandwidth', () => {
  it('names hls.js while it plays HLS, and the native player otherwise', () => {
    const { engine } = setup();
    expect(engine.decoder).toBe('native');
    engine.setSource(URL, { hls: true });
    expect(engine.decoder).toBe('hlsjs');
    engine.setSource('https://media.example/file.mp4', { hls: false });
    expect(engine.decoder).toBe('native');
  });

  it('plays HLS natively, and says so, when hls.js is not supported', () => {
    FakeHls.supported = false;
    const { engine } = setup();
    engine.setSource(URL, { hls: true });
    expect(engine.decoder).toBe('native');
  });

  it('gives null for an estimate of 0 or Infinity, which is no reading', () => {
    const { engine } = setup();
    engine.setSource(URL, { hls: true });
    const hls = FakeHls.instances[0]!;
    hls.bandwidthEstimate = 0;
    expect(engine.bandwidthEstimate).toBeNull();
    hls.bandwidthEstimate = Number.POSITIVE_INFINITY;
    expect(engine.bandwidthEstimate).toBeNull();
    hls.bandwidthEstimate = -5;
    expect(engine.bandwidthEstimate).toBeNull();
  });

  it('hands out the hls.js estimate once it has one, and null before or off hls.js', () => {
    const { engine } = setup();
    expect(engine.bandwidthEstimate).toBeNull();
    engine.setSource(URL, { hls: true });
    expect(engine.bandwidthEstimate).toBeNull();
    FakeHls.instances[0]!.bandwidthEstimate = 12_500_000;
    expect(engine.bandwidthEstimate).toBe(12_500_000);
    engine.setSource('https://media.example/file.mp4', { hls: false });
    expect(engine.bandwidthEstimate).toBeNull();
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

describe('HtmlVideoEngine media data', () => {
  it('reports each loaded hls.js fragment and the elements progress, and stops after release', () => {
    const { el, engine } = setup();
    const data = vi.fn();
    engine.on('data', data);
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.loadFragment();
    expect(data).toHaveBeenCalledTimes(1);
    el.dispatchEvent(new Event('progress'));
    expect(data).toHaveBeenCalledTimes(2);
    engine.release();
    FakeHls.instances[0]!.loadFragment();
    el.dispatchEvent(new Event('progress'));
    expect(data).toHaveBeenCalledTimes(2);
  });

  it('ignores a fragment that a replaced hls.js instance loads late', () => {
    const { engine } = setup();
    const data = vi.fn();
    engine.on('data', data);
    engine.setSource(URL, { hls: true });
    engine.setSource(URL, { hls: true });
    FakeHls.instances[0]!.loadFragment();
    expect(data).not.toHaveBeenCalled();
    FakeHls.instances[1]!.loadFragment();
    expect(data).toHaveBeenCalledTimes(1);
  });

  it('stops listening when unsubscribed', () => {
    const { engine } = setup();
    const data = vi.fn();
    const off = engine.on('data', data);
    engine.setSource(URL, { hls: true });
    off();
    FakeHls.instances[0]!.loadFragment();
    expect(data).not.toHaveBeenCalled();
  });
});
