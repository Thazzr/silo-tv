import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for HTMLImageElement that records what was set on it.
class FakeImage {
  static instances: FakeImage[] = [];
  decoding = '';
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
}

// `held` lives at module level, so every test loads a fresh copy of the module.
async function load() {
  vi.resetModules();
  return (await import('./prefetch')).prefetchImage;
}

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefetchImage', () => {
  it('starts an async decode of the picture', async () => {
    const prefetchImage = await load();
    prefetchImage('https://img.test/a.jpg');
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0]).toMatchObject({
      src: 'https://img.test/a.jpg',
      decoding: 'async',
    });
  });

  it('ignores a missing or empty URL', async () => {
    const prefetchImage = await load();
    prefetchImage(null);
    prefetchImage('');
    expect(FakeImage.instances).toHaveLength(0);
  });

  it('fetches a URL only once while it is held, and different URLs each', async () => {
    const prefetchImage = await load();
    prefetchImage('https://img.test/a.jpg');
    prefetchImage('https://img.test/a.jpg');
    expect(FakeImage.instances).toHaveLength(1);
    prefetchImage('https://img.test/b.jpg');
    expect(FakeImage.instances).toHaveLength(2);
    expect(FakeImage.instances[1]?.src).toBe('https://img.test/b.jpg');
  });

  it('holds 160 pictures, and drops the oldest first beyond that', async () => {
    const prefetchImage = await load();
    const url = (n: number) => `https://img.test/${n}.jpg`;
    for (let n = 0; n < 160; n++) prefetchImage(url(n));
    expect(FakeImage.instances).toHaveLength(160);
    // At the limit nothing is dropped yet: both ends are still held.
    prefetchImage(url(0));
    prefetchImage(url(159));
    expect(FakeImage.instances).toHaveLength(160);

    // One more pushes the oldest (0) out, and only that one.
    prefetchImage(url(160));
    expect(FakeImage.instances).toHaveLength(161);
    prefetchImage(url(1));
    expect(FakeImage.instances).toHaveLength(161);
    prefetchImage(url(0));
    expect(FakeImage.instances).toHaveLength(162);
    expect(FakeImage.instances[161]?.src).toBe(url(0));
  });

  it('keeps the held set at 160 over a long run', async () => {
    const prefetchImage = await load();
    for (let n = 0; n < 400; n++) prefetchImage(`https://img.test/${n}.jpg`);
    const before = FakeImage.instances.length;
    // The last 160 are held, everything earlier is gone.
    prefetchImage('https://img.test/399.jpg');
    prefetchImage('https://img.test/240.jpg');
    expect(FakeImage.instances).toHaveLength(before);
    prefetchImage('https://img.test/239.jpg');
    expect(FakeImage.instances).toHaveLength(before + 1);
  });
});
