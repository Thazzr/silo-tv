import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeBridge, fake, installFakeBridge } from '../../test/fakeBridge';
import { isWebOS, lunaCall, pendingBridgeCount } from './luna';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lunaCall', () => {
  it('resolves with the parsed JSON and sends the params as a JSON string', async () => {
    installFakeBridge();
    fake.responders.set('luna://a/b', () => JSON.stringify({ returnValue: true, value: 7 }));
    await expect(lunaCall('luna://a/b', { x: 1 })).resolves.toEqual({
      returnValue: true,
      value: 7,
    });
    expect(fake.calls).toEqual([{ uri: 'luna://a/b', params: { x: 1 } }]);
  });

  it('also works with the legacy PalmServiceBridge', async () => {
    installFakeBridge('PalmServiceBridge');
    fake.responders.set('luna://a/b', () => JSON.stringify({ returnValue: true }));
    await expect(lunaCall('luna://a/b')).resolves.toEqual({ returnValue: true });
  });

  it('rejects with errorText and errorCode when returnValue is false', async () => {
    installFakeBridge();
    fake.responders.set('luna://a/b', () =>
      JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'denied' }),
    );
    await expect(lunaCall('luna://a/b')).rejects.toMatchObject({
      message: 'denied',
      errorText: 'denied',
      errorCode: -1,
    });
  });

  it('rejects a non-JSON response', async () => {
    installFakeBridge();
    fake.responders.set('luna://a/b', () => 'not json');
    await expect(lunaCall('luna://a/b')).rejects.toThrow(/non-JSON/);
  });

  it('rejects after the timeout when no callback arrives', async () => {
    vi.useFakeTimers();
    installFakeBridge();
    fake.responders.set('luna://a/b', () => null);
    const result = lunaCall('luna://a/b', {}, { timeoutMs: 1000 });
    const assertion = expect(result).rejects.toThrow(/timed out after 1000 ms/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(pendingBridgeCount()).toBe(0);
  });

  it('uses a default timeout of 5000 ms', async () => {
    vi.useFakeTimers();
    installFakeBridge();
    fake.responders.set('luna://a/b', () => null);
    const result = lunaCall('luna://a/b');
    const assertion = expect(result).rejects.toThrow(/5000 ms/);
    await vi.advanceTimersByTimeAsync(4999);
    expect(pendingBridgeCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('rejects when no bridge exists', async () => {
    await expect(lunaCall('luna://a/b')).rejects.toThrow(/No Luna service bridge/);
  });

  it('holds the bridge until the callback fired and releases it afterwards', async () => {
    installFakeBridge();
    let reply: (() => void) | undefined;
    fake.responders.set('luna://a/b', () => {
      const bridge = fake.instances[0];
      reply = () => bridge?.onservicecallback?.(JSON.stringify({ returnValue: true }));
      return null;
    });
    expect(pendingBridgeCount()).toBe(0);
    const result = lunaCall('luna://a/b');
    expect(pendingBridgeCount()).toBe(1);
    reply?.();
    await result;
    expect(pendingBridgeCount()).toBe(0);
  });
});

describe('bridge selection', () => {
  it('prefers WebOSServiceBridge when both constructors exist', async () => {
    installFakeBridge('WebOSServiceBridge');
    const palmCalls: string[] = [];
    class PalmFake extends FakeBridge {
      override call(uri: string) {
        palmCalls.push(uri);
      }
    }
    vi.stubGlobal('PalmServiceBridge', PalmFake);
    fake.responders.set('luna://a/b', () => JSON.stringify({ returnValue: true }));
    await lunaCall('luna://a/b');
    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0]).not.toBeInstanceOf(PalmFake);
    expect(palmCalls).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('isWebOS', () => {
  it('is false without a bridge constructor', () => {
    expect(isWebOS()).toBe(false);
  });

  it.each(['WebOSServiceBridge', 'PalmServiceBridge'] as const)('is true with %s', (name) => {
    installFakeBridge(name);
    expect(isWebOS()).toBe(true);
  });
});
