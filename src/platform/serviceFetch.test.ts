import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake, installFakeBridge } from '../test/fakeBridge';
import { pendingBridgeCount } from './luna';
import { APP_ID, SERVICE_ID, serviceFetch, servicePing } from './serviceFetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('serviceFetch bridge timeout', () => {
  // The bridge must outlive the service's own timeout, or the service error never arrives.
  it.each([
    [1000, 6000],
    [undefined, 20000],
  ])('with service timeout %s the Luna timeout is %i ms', async (timeoutMs, lunaMs) => {
    vi.useFakeTimers();
    installFakeBridge();
    fake.responders.set(`luna://${SERVICE_ID}/fetch`, () => null);
    const result = serviceFetch({ url: 'https://silo.example.test/api/v2/x', timeoutMs });
    const assertion = expect(result).rejects.toThrow(`timed out after ${lunaMs} ms`);
    await vi.advanceTimersByTimeAsync(lunaMs - 1);
    expect(pendingBridgeCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(lunaMs).toBeGreaterThan(timeoutMs ?? 15000);
  });
});

describe('serviceFetch', () => {
  it('derives the service id from the app id', () => {
    expect(SERVICE_ID).toBe(`${APP_ID}.service`);
  });

  it('calls the fetch command with the request as parameters', async () => {
    installFakeBridge();
    const response = { returnValue: true, status: 200, statusText: 'OK', headers: {}, body: '{}' };
    fake.responders.set(`luna://${SERVICE_ID}/fetch`, () => JSON.stringify(response));
    const req = { url: 'https://silo.example.test/api/v2/x', method: 'POST', body: '{}' };
    await expect(serviceFetch(req)).resolves.toEqual(response);
    expect(fake.calls).toEqual([{ uri: `luna://${SERVICE_ID}/fetch`, params: req }]);
  });

  it('maps a service failure to a rejection', async () => {
    installFakeBridge();
    fake.responders.set(`luna://${SERVICE_ID}/fetch`, () =>
      JSON.stringify({ returnValue: false, errorText: 'connect ECONNREFUSED' }),
    );
    await expect(serviceFetch({ url: 'https://silo.example.test/api/v2/x' })).rejects.toThrow(
      'connect ECONNREFUSED',
    );
  });
});

describe('servicePing', () => {
  it('calls the ping command', async () => {
    installFakeBridge();
    fake.responders.set(`luna://${SERVICE_ID}/ping`, () =>
      JSON.stringify({ returnValue: true, node: 'v12.0.0', sender: `${APP_ID} 4242` }),
    );
    await expect(servicePing()).resolves.toEqual({
      returnValue: true,
      node: 'v12.0.0',
      sender: `${APP_ID} 4242`,
    });
    expect(fake.calls).toEqual([{ uri: `luna://${SERVICE_ID}/ping`, params: {} }]);
  });
});
