import { beforeEach, describe, expect, it, vi } from 'vitest';

const hls = vi.hoisted(() => ({ supported: true }));
vi.mock('hls.js', () => ({ default: { isSupported: () => hls.supported } }));

import { collectProfileProbe } from './probe';

describe('collectProfileProbe', () => {
  beforeEach(() => {
    hls.supported = true;
  });

  it('reports hls.js support as hlsJs when it is supported', async () => {
    hls.supported = true;
    expect((await collectProfileProbe()).hlsJs).toBe(true);
  });

  it('reports hlsJs false when hls.js is not supported', async () => {
    hls.supported = false;
    expect((await collectProfileProbe()).hlsJs).toBe(false);
  });
});
