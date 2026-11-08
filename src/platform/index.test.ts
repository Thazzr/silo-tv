import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake, installFakeBridge } from '../test/fakeBridge';
import { getPlatform, setPlatformForTests } from '.';

afterEach(() => {
  vi.unstubAllGlobals();
  setPlatformForTests(null);
});

describe('getPlatform', () => {
  it('picks the browser without a Luna bridge', () => {
    expect(getPlatform().id).toBe('browser');
  });

  it.each(['WebOSServiceBridge', 'PalmServiceBridge'] as const)('picks webOS with %s', (name) => {
    installFakeBridge(name);
    expect(getPlatform().id).toBe('webos');
    expect(getPlatform().proxyFetch).toBeTypeOf('function');
  });

  it('is memoised: a bridge that appears later does not switch the platform', () => {
    const first = getPlatform();
    installFakeBridge();
    expect(getPlatform()).toBe(first);
    expect(first.id).toBe('browser');
    expect(fake.instances).toHaveLength(0);
  });

  it('setPlatformForTests pins a platform and null detects again', () => {
    const pinned = { ...getPlatform(), id: 'webos' as const };
    setPlatformForTests(pinned);
    expect(getPlatform()).toBe(pinned);
    setPlatformForTests(null);
    expect(getPlatform().id).toBe('browser');
  });
});
