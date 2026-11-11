// Direct tests of the device-code sign-in hook. The client is a scripted fake behind the silo
// context, so every request and every timer step is exact; the screen's own tests
// (SignInScreen.test.tsx) cover the same flow through MSW and the rendered UI.
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../api/generated/schema';
import { getPlatform } from '../../platform';
import { capability, devicePoll, deviceStart, tokenPair } from '../../test/flowFixtures';
import { newQueryClient } from '../../test/renderFlow';
import { useDeviceLogin } from './useDeviceLogin';

type S = components['schemas'];

// What the hook gets from the silo context; set per test.
const context = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../app/SiloContext', () => ({ useSilo: () => context.value }));

type Result = { data?: unknown; error?: unknown; response: Response };
const ok = (data: unknown): Result => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, headers: Record<string, string> = {}): Result => ({
  data: undefined,
  error: { title: `HTTP ${status}` },
  response: new Response(null, { status, headers }),
});

interface Script {
  capability: () => Promise<Result>;
  start: () => Promise<Result>;
  poll: (n: number) => Promise<Result>;
  cancel: () => Promise<Result>;
}

function setup(script: Partial<Script> = {}, baseUrl = 'https://silo.example.test') {
  const s: Script = {
    capability: async () => ok(capability),
    start: async () => ok(deviceStart()),
    poll: async () => ok(devicePoll()),
    cancel: async () => ok({ status: 'canceled' }),
    ...script,
  };
  const calls = {
    capability: 0,
    start: [] as unknown[],
    poll: [] as unknown[],
    cancel: [] as unknown[],
  };
  const client = {
    GET: vi.fn(async (path: string) => {
      expect(path).toBe('/api/v2/auth/device/capability');
      calls.capability += 1;
      return s.capability();
    }),
    POST: vi.fn(async (path: string, init: { body: unknown }) => {
      switch (path) {
        case '/api/v2/auth/device/start':
          calls.start.push(init.body);
          return s.start();
        case '/api/v2/auth/device/poll':
          calls.poll.push(init.body);
          return s.poll(calls.poll.length);
        case '/api/v2/auth/device/cancel':
          calls.cancel.push(init.body);
          return s.cancel();
        default:
          throw new Error(`unexpected ${path}`);
      }
    }),
  };
  const session = { set: vi.fn() };
  context.value = {
    client,
    session,
    baseUrl,
    device: { id: 'a'.repeat(32), name: 'Living room TV' },
  };
  return { calls, client, session };
}

function mount(onSignedIn: () => void = vi.fn(), strict = false) {
  const queryClient = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const view = renderHook(({ cb }) => useDeviceLogin(cb), {
    wrapper,
    initialProps: { cb: onSignedIn },
  });
  return { ...view, queryClient };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
/** Capability answered, code started: the screen shows the code and waits for the first poll. */
async function settle() {
  await advance(0);
  await advance(0);
}

beforeAll(() => {
  // React Query's own setTimeout(0) would take part in the fake clock; a microtask does not.
  notifyManager.setScheduler((callback) => queueMicrotask(callback));
});
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => vi.useRealTimers());

describe('useDeviceLogin capability and start', () => {
  it('checks the capability first, under a key of this server', async () => {
    setup();
    const { result, queryClient } = mount();
    expect(result.current.state).toEqual({ phase: 'checking' });
    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual([
      'deviceLogin',
      'https://silo.example.test',
      'capability',
    ]);
    await settle();
    expect(result.current.state.phase).toBe('waiting');
  });

  it('asks the capability again on every mount', async () => {
    const { calls } = setup();
    const first = mount();
    await settle();
    first.unmount();
    mount();
    await settle();
    expect(calls.capability).toBe(2);
  });

  it('starts one code for this device and shows it, not yet opened', async () => {
    const { calls } = setup();
    const { result } = mount();
    await settle();
    expect(calls.start).toEqual([
      { device_name: 'Living room TV', device_platform: getPlatform().siloPlatformId },
    ]);
    expect(result.current.state).toEqual({
      phase: 'waiting',
      code: deviceStart(),
      opened: false,
    });
  });

  it('starts only one code even when React runs the effect twice', async () => {
    const { calls } = setup();
    mount(vi.fn(), true);
    await settle();
    expect(calls.start).toHaveLength(1);
  });

  it('does not start a second code when the capability flips away and comes back', async () => {
    let state: S['DeviceLoginCapability']['state'] = 'available';
    const { calls } = setup({ capability: async () => ok({ ...capability, state }) });
    const { result, queryClient } = mount();
    await settle();
    expect(calls.start).toHaveLength(1);
    // A refetch (window focus, reconnect) may find the feature off and later on again.
    state = 'disabled';
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(result.current.state).toEqual({ phase: 'unavailable' });
    state = 'available';
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await settle();
    expect(calls.start).toHaveLength(1);
  });

  it.each(['disabled', 'not_configured', 'unsupported'] as const)(
    'is unavailable, without a code, when the server says %s',
    async (state) => {
      const { calls } = setup({ capability: async () => ok({ ...capability, state }) });
      const { result } = mount();
      await settle();
      expect(result.current.state).toEqual({ phase: 'unavailable' });
      expect(calls.start).toHaveLength(0);
    },
  );

  it('is unavailable when the server is available but does not allow it', async () => {
    const { calls } = setup({ capability: async () => ok({ ...capability, allowed: false }) });
    const { result } = mount();
    await settle();
    expect(result.current.state).toEqual({ phase: 'unavailable' });
    expect(calls.start).toHaveLength(0);
  });

  it('treats a missing allowed flag as allowed', async () => {
    const withoutFlag: Partial<typeof capability> = { ...capability };
    delete withoutFlag.allowed;
    const { calls } = setup({ capability: async () => ok(withoutFlag) });
    mount();
    await settle();
    expect(calls.start).toHaveLength(1);
  });

  it('is an error when the capability cannot be read', async () => {
    const { calls } = setup({ capability: async () => failure(500) });
    const { result } = mount();
    await settle();
    expect(result.current.state).toEqual({ phase: 'error' });
    expect(calls.start).toHaveLength(0);
  });

  it('is an error, not a code, when the start fails', async () => {
    const { calls } = setup({ start: async () => failure(500) });
    const { result } = mount();
    await settle();
    expect(result.current.state).toEqual({ phase: 'error' });
    expect(calls.poll).toHaveLength(0);
    await advance(60_000);
    expect(calls.poll).toHaveLength(0);
  });

  it('follows a changed sign-in callback', async () => {
    setup({ poll: async () => ok(devicePoll({ status: 'approved', tokens: tokenPair })) });
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = mount(first);
    await settle();
    rerender({ cb: second });
    await advance(5_000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('useDeviceLogin polling', () => {
  it('waits the interval before every poll, at least one second', async () => {
    const { calls } = setup({
      start: async () => ok(deviceStart({ interval: 0 })),
      poll: async () => ok(devicePoll({ poll_after: 1 })),
    });
    mount();
    await settle();
    await advance(999);
    expect(calls.poll).toHaveLength(0);
    await advance(1);
    expect(calls.poll).toEqual([{ device_code: 'device-code-1' }]);
    await advance(1_000);
    expect(calls.poll).toHaveLength(2);
  });

  it('polls every five seconds when the code names no interval', async () => {
    const { calls } = setup({
      start: async () =>
        ok({ ...deviceStart(), interval: undefined } as unknown as S['DeviceLoginStart']),
      poll: async () => ok(devicePoll({ poll_after: 0 })),
    });
    mount();
    await settle();
    await advance(4_999);
    expect(calls.poll).toHaveLength(0);
    await advance(1);
    expect(calls.poll).toHaveLength(1);
  });

  it('keeps its wait when the server says poll_after 0, and takes any positive one', async () => {
    const { calls } = setup({
      poll: async (n) => ok(devicePoll({ poll_after: n === 1 ? 0 : 2 })),
    });
    mount();
    await settle();
    await advance(5_000);
    expect(calls.poll).toHaveLength(1);
    // Zero keeps the interval of 5 s instead of polling at once.
    await advance(4_999);
    expect(calls.poll).toHaveLength(1);
    await advance(1);
    expect(calls.poll).toHaveLength(2);
    await advance(1_999);
    expect(calls.poll).toHaveLength(2);
    await advance(1);
    expect(calls.poll).toHaveLength(3);
  });

  it('keeps a pending code waiting and shows that it was opened', async () => {
    setup({ poll: async () => ok(devicePoll({ opened: true })) });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(result.current.state).toMatchObject({ phase: 'waiting', opened: true });
  });

  it('stores the tokens of an approval, tells the flow once and stops polling', async () => {
    const { calls, session } = setup({
      poll: async () => ok(devicePoll({ status: 'approved', tokens: tokenPair })),
    });
    const onSignedIn = vi.fn();
    mount(onSignedIn);
    await settle();
    await advance(5_000);
    expect(session.set).toHaveBeenCalledTimes(1);
    expect(session.set).toHaveBeenCalledWith({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      expiresAt: Date.now() + 3_600_000,
      user: tokenPair.user,
    });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it('is an error when an approval carries no tokens', async () => {
    const { session } = setup({ poll: async () => ok(devicePoll({ status: 'approved' })) });
    const onSignedIn = vi.fn();
    const { result } = mount(onSignedIn);
    await settle();
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'error' });
    expect(session.set).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('is denied when the viewer refused', async () => {
    const { calls } = setup({ poll: async () => ok(devicePoll({ status: 'denied' })) });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'denied' });
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it.each(['expired', 'consumed', 'canceled'] as const)(
    'is expired when the poll says %s',
    async (status) => {
      const { calls } = setup({ poll: async () => ok(devicePoll({ status })) });
      const { result } = mount();
      await settle();
      await advance(5_000);
      expect(result.current.state).toEqual({ phase: 'expired' });
      await advance(60_000);
      expect(calls.poll).toHaveLength(1);
    },
  );
});

describe('useDeviceLogin expiry', () => {
  it('polls at the deadline itself and expires after it, without another poll', async () => {
    const { calls } = setup({
      start: async () =>
        ok(deviceStart({ expires_at: new Date(Date.now() + 10_000).toISOString() })),
    });
    const { result } = mount();
    await settle();
    await advance(5_000);
    await advance(5_000);
    // The tick at exactly the deadline still polls.
    expect(calls.poll).toHaveLength(2);
    expect(result.current.state.phase).toBe('waiting');
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'expired' });
    expect(calls.poll).toHaveLength(2);
  });

  it('follows the deadline of a pending answer', async () => {
    const { calls } = setup({
      start: async () =>
        ok(deviceStart({ expires_at: new Date(Date.now() + 8_000).toISOString() })),
      poll: async () =>
        ok(devicePoll({ expires_at: new Date(Date.now() + 100_000).toISOString() })),
    });
    const { result } = mount();
    await settle();
    await advance(5_000);
    await advance(5_000);
    expect(result.current.state.phase).toBe('waiting');
    expect(calls.poll).toHaveLength(2);
  });

  it('ignores an unreadable deadline in a pending answer', async () => {
    const { calls } = setup({
      start: async () =>
        ok(deviceStart({ expires_at: new Date(Date.now() + 8_000).toISOString() })),
      poll: async () => ok(devicePoll({ expires_at: 'soon' })),
    });
    const { result } = mount();
    await settle();
    await advance(5_000);
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'expired' });
    expect(calls.poll).toHaveLength(1);
  });

  it('counts expires_in from now when the start has no readable expires_at', async () => {
    const { calls } = setup({
      start: async () => ok(deviceStart({ expires_at: 'garbage', expires_in: 100, interval: 10 })),
      poll: async () => ok(devicePoll({ poll_after: 10 })),
    });
    const { result } = mount();
    await settle();
    await advance(100_000);
    // Ten polls (10 s .. 100 s); the one at 100 s is not past the deadline yet.
    expect(calls.poll).toHaveLength(10);
    expect(result.current.state.phase).toBe('waiting');
    await advance(10_000);
    expect(result.current.state).toEqual({ phase: 'expired' });
    expect(calls.poll).toHaveLength(10);
  });

  it('assumes fifteen minutes when the start names no expiry at all', async () => {
    const { calls } = setup({
      start: async () =>
        ok({
          ...deviceStart(),
          expires_at: undefined,
          expires_in: undefined,
          interval: 300,
        } as unknown as S['DeviceLoginStart']),
      poll: async () => ok(devicePoll({ poll_after: 300 })),
    });
    const { result } = mount();
    await settle();
    await advance(900_000);
    expect(calls.poll).toHaveLength(3);
    expect(result.current.state.phase).toBe('waiting');
    await advance(300_000);
    expect(result.current.state).toEqual({ phase: 'expired' });
    expect(calls.poll).toHaveLength(3);
  });
});

describe('useDeviceLogin poll failures', () => {
  const problem = (status: number) => async () => failure(status);

  it.each([404, 410])('is expired on %i', async (status) => {
    const { calls } = setup({ poll: problem(status) });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'expired' });
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it.each([400, 401, 403, 422, 499])('is an error on %i, at once', async (status) => {
    const { calls } = setup({ poll: problem(status) });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'error' });
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it.each([408, 500, 502, 503])(
    'retries %i after the usual wait and gives up after five',
    async (status) => {
      const { calls } = setup({ poll: problem(status) });
      const { result } = mount();
      await settle();
      for (let i = 1; i <= 4; i++) {
        await advance(i === 1 ? 5_000 : 5_000);
        expect(calls.poll).toHaveLength(i);
        expect(result.current.state.phase).toBe('waiting');
      }
      await advance(4_999);
      expect(calls.poll).toHaveLength(4);
      await advance(1);
      expect(calls.poll).toHaveLength(5);
      expect(result.current.state).toEqual({ phase: 'error' });
      await advance(60_000);
      expect(calls.poll).toHaveLength(5);
    },
  );

  it('retries after a network error as it does after a 5xx', async () => {
    const { calls } = setup({
      poll: async (n) => {
        if (n < 5) throw new TypeError('network');
        return ok(devicePoll({ status: 'denied' }));
      },
    });
    const { result } = mount();
    await settle();
    await advance(25_000);
    expect(calls.poll).toHaveLength(5);
    expect(result.current.state).toEqual({ phase: 'denied' });
  });

  it('gives up after five network errors in a row', async () => {
    const { calls } = setup({
      poll: async () => {
        throw new TypeError('network');
      },
    });
    const { result } = mount();
    await settle();
    await advance(60_000);
    expect(calls.poll).toHaveLength(5);
    expect(result.current.state).toEqual({ phase: 'error' });
  });

  it('forgets earlier failures after an answer', async () => {
    const { calls } = setup({
      poll: async (n) => (n % 5 === 0 ? ok(devicePoll()) : failure(503)),
    });
    const { result } = mount();
    await settle();
    // Four failures, an answer, four failures, an answer: never five in a row.
    await advance(50_000);
    expect(calls.poll).toHaveLength(10);
    expect(result.current.state.phase).toBe('waiting');
  });

  it('does not count a 429 as a failure and waits the longer of Retry-After and its wait', async () => {
    const { calls } = setup({
      poll: async (n) => {
        if (n <= 6) return failure(429, { 'Retry-After': n === 1 ? '2' : '12' });
        return ok(devicePoll());
      },
    });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(calls.poll).toHaveLength(1);
    // Retry-After 2 s is shorter than the 5 s wait: the wait counts.
    await advance(4_999);
    expect(calls.poll).toHaveLength(1);
    await advance(1);
    expect(calls.poll).toHaveLength(2);
    // Retry-After 12 s wins.
    await advance(11_999);
    expect(calls.poll).toHaveLength(2);
    await advance(1);
    expect(calls.poll).toHaveLength(3);
    // Six rate limits in a row are still no reason to give up.
    await advance(12_000 * 3);
    expect(calls.poll).toHaveLength(6);
    expect(result.current.state.phase).toBe('waiting');
  });

  it('waits its normal interval after a 429 without Retry-After', async () => {
    const { calls } = setup({
      poll: async (n) => (n === 1 ? failure(429) : ok(devicePoll())),
    });
    mount();
    await settle();
    await advance(5_000);
    await advance(4_999);
    expect(calls.poll).toHaveLength(1);
    await advance(1);
    expect(calls.poll).toHaveLength(2);
  });
});

describe('useDeviceLogin leaving', () => {
  it('stops polling on unmount and leaves no timer', async () => {
    const { calls } = setup();
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = mount();
    await settle();
    await advance(5_000);
    expect(calls.poll).toHaveLength(1);
    // The timer of the next poll (5 s) is cancelled with the screen, not just ignored.
    const index = scheduled.mock.calls.findLastIndex(([, ms]) => ms === 5_000);
    const pollTimer = scheduled.mock.results[index]!.value;
    unmount();
    expect(cleared).toHaveBeenCalledWith(pollTimer);
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it('drops an approval that arrives after the screen is gone', async () => {
    let answer: (value: Result) => void = () => {};
    const { session } = setup({
      poll: () => new Promise<Result>((resolve) => (answer = resolve)),
    });
    const onSignedIn = vi.fn();
    const { unmount } = mount(onSignedIn);
    await settle();
    await advance(5_000);
    unmount();
    answer(ok(devicePoll({ status: 'approved', tokens: tokenPair })));
    await advance(0);
    expect(session.set).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('does not schedule another poll when a failure arrives after the screen is gone', async () => {
    let fail: (reason: unknown) => void = () => {};
    const { calls } = setup({
      poll: () => new Promise<Result>((_resolve, reject) => (fail = reject)),
    });
    const { unmount } = mount();
    await settle();
    await advance(5_000);
    unmount();
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    // The request itself fails (no answer at all), so the catch path runs.
    fail(new TypeError('network'));
    await advance(0);
    // No next poll (5 s) is scheduled for a screen that is gone.
    expect(scheduled.mock.calls.filter(([, ms]) => ms === 5_000)).toHaveLength(0);
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it('withdraws the code on cancel, drops it and stops polling', async () => {
    const { calls } = setup();
    const { result } = mount();
    await settle();
    await advance(5_000);
    act(() => result.current.cancel());
    await advance(0);
    expect(calls.cancel).toEqual([{ device_code: 'device-code-1' }]);
    expect(result.current.state).toEqual({ phase: 'checking' });
    await advance(60_000);
    expect(calls.poll).toHaveLength(1);
  });

  it('does not withdraw when the server says the device cannot', async () => {
    const { calls } = setup({ capability: async () => ok({ ...capability, cancel: false }) });
    const { result } = mount();
    await settle();
    act(() => result.current.cancel());
    await advance(0);
    expect(calls.cancel).toHaveLength(0);
    expect(result.current.state).toEqual({ phase: 'checking' });
  });

  it('does not withdraw a code that is already finished', async () => {
    const { calls } = setup({ poll: async () => ok(devicePoll({ status: 'denied' })) });
    const { result } = mount();
    await settle();
    await advance(5_000);
    act(() => result.current.cancel());
    await advance(0);
    expect(calls.cancel).toHaveLength(0);
  });

  it('does not withdraw before a code exists', async () => {
    const { calls } = setup({ start: () => new Promise<Result>(() => {}) });
    const { result } = mount();
    await settle();
    act(() => result.current.cancel());
    await advance(0);
    expect(calls.cancel).toHaveLength(0);
  });

  it('ignores a failing withdrawal', async () => {
    const { calls } = setup({
      cancel: async () => {
        throw new TypeError('network');
      },
    });
    const { result } = mount();
    await settle();
    act(() => result.current.cancel());
    await advance(0);
    expect(calls.cancel).toHaveLength(1);
    expect(result.current.state).toEqual({ phase: 'checking' });
  });
});

describe('useDeviceLogin restart', () => {
  it('drops the old state at once and starts a new code', async () => {
    let release: (value: Result) => void = () => {};
    let starts = 0;
    const { calls } = setup({
      start: () => {
        starts += 1;
        if (starts === 1) return Promise.resolve(ok(deviceStart()));
        return new Promise<Result>((resolve) => (release = resolve));
      },
      poll: async () => ok(devicePoll({ status: 'denied' })),
    });
    const { result } = mount();
    await settle();
    await advance(5_000);
    expect(result.current.state).toEqual({ phase: 'denied' });

    act(() => result.current.restart());
    // Neither the old code nor the old outcome is shown while the new code is on its way.
    expect(result.current.state).toEqual({ phase: 'checking' });
    await advance(0);
    expect(result.current.state).toEqual({ phase: 'checking' });
    expect(calls.start).toHaveLength(2);

    release(ok(deviceStart({ device_code: 'device-code-2' })));
    await advance(0);
    expect(result.current.state).toMatchObject({
      phase: 'waiting',
      code: { device_code: 'device-code-2' },
    });
    await advance(5_000);
    expect(calls.poll[1]).toEqual({ device_code: 'device-code-2' });
  });

  it('reads the capability again instead when the server offers no code sign-in', async () => {
    const { calls } = setup({ capability: async () => ok({ ...capability, state: 'disabled' }) });
    const { result } = mount();
    await settle();
    expect(calls.capability).toBe(1);
    act(() => result.current.restart());
    await advance(0);
    await advance(0);
    expect(calls.capability).toBe(2);
    expect(calls.start).toHaveLength(0);
    expect(result.current.state).toEqual({ phase: 'unavailable' });
  });

  it('starts a code after the capability came back available', async () => {
    let answer: 'disabled' | 'available' = 'disabled';
    const { calls } = setup({
      capability: async () => ok({ ...capability, state: answer }),
    });
    const { result } = mount();
    await settle();
    expect(result.current.state).toEqual({ phase: 'unavailable' });
    answer = 'available';
    act(() => result.current.restart());
    await settle();
    expect(calls.start).toHaveLength(1);
    expect(result.current.state.phase).toBe('waiting');
  });
});
