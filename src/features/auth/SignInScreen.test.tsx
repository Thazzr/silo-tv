import { act, fireEvent, render, screen } from '@testing-library/react';
import { notifyManager } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL } from '../../test/apiFixtures';
import { installFakeBridge } from '../../test/fakeBridge';
import { setPlatformForTests } from '../../platform';
import {
  authProviders,
  capability,
  deviceStart,
  devicePoll,
  tokenPair,
} from '../../test/flowFixtures';
import { renderWithSilo } from '../../test/renderFlow';
import { formatUserCode } from './format';
import { encode } from 'uqr';
import { QrCode, SignInScreen } from './SignInScreen';

// MSW answers on real I/O turns, so every step lets a few real macrotasks pass between rounds
// of faked timers.
const realSetTimeout = globalThis.setTimeout;
const realTurn = () => new Promise<void>((resolve) => realSetTimeout(resolve, 5));

const server = setupServer();
// By request id: a request of an earlier test that ends late must not count against this one.
const inFlight = new Set<string>();
server.events.on('request:start', ({ requestId }) => void inFlight.add(requestId));
server.events.on('request:end', ({ requestId }) => void inFlight.delete(requestId));

/** Advances the fake clock, then lets every request that started finish and render. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 40; i++) {
    await act(async () => {
      await realTurn();
      await vi.advanceTimersByTimeAsync(0);
    });
    if (i >= 2 && inFlight.size === 0) break;
  }
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  // React Query hands results to React through setTimeout(0), which the fake clock would turn into
  // a 1 ms step whenever it is scheduled from inside a tick: the code's first poll then lands at
  // 5001 ms. A microtask keeps the timing of the screen's own timers exact.
  notifyManager.setScheduler((callback) => queueMicrotask(callback));
});
beforeEach(() => {
  inFlight.clear();
});
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => {
  vi.unstubAllGlobals();
  setPlatformForTests(null);
  vi.useRealTimers();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

interface Calls {
  start: unknown[];
  poll: unknown[];
  cancel: unknown[];
}

function mockServer(
  options: {
    capabilityBody?: object;
    polls?: (n: number) => Response;
    starts?: object[];
    providers?: object;
  } = {},
): Calls {
  const calls: Calls = { start: [], poll: [], cancel: [] };
  server.use(
    http.get(`${BASE_URL}/api/v2/auth/providers`, () =>
      HttpResponse.json(options.providers ?? authProviders([], false)),
    ),
    http.get(`${BASE_URL}/api/v2/auth/device/capability`, () =>
      HttpResponse.json(options.capabilityBody ?? capability),
    ),
    http.post(`${BASE_URL}/api/v2/auth/device/start`, async ({ request }) => {
      calls.start.push(await request.json());
      const next = options.starts?.[calls.start.length - 1] ?? deviceStart();
      return HttpResponse.json(next, { status: 201 });
    }),
    http.post(`${BASE_URL}/api/v2/auth/device/poll`, async ({ request }) => {
      calls.poll.push(await request.json());
      return (
        options.polls?.(calls.poll.length) ?? HttpResponse.json(devicePoll({ status: 'pending' }))
      );
    }),
    http.post(`${BASE_URL}/api/v2/auth/device/cancel`, async ({ request }) => {
      calls.cancel.push(await request.json());
      return HttpResponse.json({ status: 'canceled' });
    }),
  );
  return calls;
}

function setup() {
  const onSignedIn = vi.fn();
  const onBack = vi.fn();
  const onPassword = vi.fn();
  const view = renderWithSilo(
    <SignInScreen onSignedIn={onSignedIn} onPassword={onPassword} onBack={onBack} />,
  );
  return { onSignedIn, onBack, onPassword, ...view };
}

describe('formatUserCode', () => {
  it.each([
    ['4821-7730', '4821 7730'],
    ['48217730', '4821 7730'],
    ['4821 7730', '4821 7730'],
    ['abc-def', 'abc def'],
  ])('shows %s as %s', (input, output) => {
    expect(formatUserCode(input)).toBe(output);
  });
});

describe('SignInScreen', () => {
  it('starts a code for this device and shows it grouped, with the address and a QR code', async () => {
    // On webOS the server is told "webos", as before.
    installFakeBridge();
    setPlatformForTests(null);
    const calls = mockServer();
    setup();
    await advance(0);
    expect(calls.start).toEqual([{ device_name: 'LG webOS TV', device_platform: 'webos' }]);
    expect(screen.getByTestId('user-code')).toHaveTextContent('4821 7730');
    expect(screen.getByTestId('verification-url')).toHaveTextContent(
      'https://silo.example.test/activate',
    );
    const qr = screen.getByTestId('qr');
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
    // The path must hold modules, and the viewBox must include the quiet zone around them.
    expect(qr.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
    const [, , width] = (qr.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(width).toBeGreaterThanOrEqual(21 + 8);
  });

  it('encodes the verification address: another address gives another QR path', () => {
    const pathOf = (value: string) => {
      const { unmount } = render(<QrCode value={value} label="qr" />);
      const d = screen.getByTestId('qr').querySelector('path')?.getAttribute('d');
      unmount();
      return d;
    };
    const a = pathOf('https://silo.example.test/activate?code=48217730');
    expect(a).toBe(pathOf('https://silo.example.test/activate?code=48217730'));
    expect(a).not.toBe(pathOf('https://silo.example.test/activate?code=11112222'));
  });

  it('waits the interval before the first poll and then polls at the interval', async () => {
    const calls = mockServer();
    setup();
    await advance(0);
    expect(calls.poll).toHaveLength(0);
    await advance(4900);
    expect(calls.poll).toHaveLength(0);
    await advance(200);
    expect(calls.poll).toEqual([{ device_code: 'device-code-1' }]);
    await advance(5000);
    expect(calls.poll).toHaveLength(2);
  });

  it('follows poll_after from the server answer', async () => {
    const calls = mockServer({
      polls: () => HttpResponse.json(devicePoll({ poll_after: 12 })),
    });
    setup();
    await advance(0);
    await advance(5000);
    expect(calls.poll).toHaveLength(1);
    await advance(11000);
    expect(calls.poll).toHaveLength(1);
    await advance(1500);
    expect(calls.poll).toHaveLength(2);
  });

  it('waits at least Retry-After after a 429', async () => {
    const calls = mockServer({
      polls: (n) =>
        n === 1
          ? new HttpResponse(
              JSON.stringify({ type: 'x/rate_limited', title: 'slow', status: 429 }),
              {
                status: 429,
                headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '30' },
              },
            )
          : HttpResponse.json(devicePoll()),
    });
    setup();
    await advance(0);
    await advance(5000);
    expect(calls.poll).toHaveLength(1);
    await advance(25000);
    expect(calls.poll).toHaveLength(1);
    await advance(6000);
    expect(calls.poll).toHaveLength(2);
    // The code is still shown: a rate limit is not the end of the sign-in.
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
  });

  it('shows that the code was opened on another device', async () => {
    mockServer({ polls: () => HttpResponse.json(devicePoll({ opened: true })) });
    setup();
    await advance(0);
    expect(screen.queryByTestId('signin-opened')).not.toBeInTheDocument();
    await advance(5000);
    expect(screen.getByTestId('signin-opened')).toHaveTextContent(
      'The code was opened on another device.',
    );
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
  });

  it('stores the tokens when the sign-in is approved, tells the flow, and stops polling', async () => {
    const calls = mockServer({
      polls: (n) =>
        n < 2
          ? HttpResponse.json(devicePoll())
          : HttpResponse.json(devicePoll({ status: 'approved', tokens: tokenPair })),
    });
    const { session, onSignedIn } = setup();
    await advance(0);
    await advance(5000);
    expect(session.get()).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
    await advance(5000);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(session.get()).toMatchObject({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      user: { id: 'user-1' },
    });
    expect(session.get()?.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
    await advance(30000);
    expect(calls.poll).toHaveLength(2);
  });

  it('keeps a profile the server bound to the session', async () => {
    mockServer({
      polls: () =>
        HttpResponse.json(
          devicePoll({
            status: 'approved',
            tokens: tokenPair,
            profile_id: 'p9',
            profile_token: 'pvt_x',
            temporary: true,
          }),
        ),
    });
    const { session } = setup();
    await advance(0);
    await advance(5000);
    expect(session.get()).toMatchObject({ profileId: 'p9', profileToken: 'pvt_x' });
  });

  it('shows the denied state and starts a new code on request', async () => {
    const calls = mockServer({
      polls: (n) => HttpResponse.json(devicePoll({ status: n === 1 ? 'denied' : 'pending' })),
      starts: [
        deviceStart(),
        deviceStart({ device_code: 'device-code-2', user_code: '1111-2222' }),
      ],
    });
    const { onSignedIn } = setup();
    await advance(0);
    await advance(5000);
    expect(screen.getByTestId('signin-denied')).toHaveTextContent('The sign-in was denied.');
    expect(screen.queryByTestId('user-code')).not.toBeInTheDocument();
    await advance(20000);
    expect(calls.poll).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'New code' }));
    await advance(0);
    expect(calls.start).toHaveLength(2);
    expect(screen.getByTestId('user-code')).toHaveTextContent('1111 2222');
    await advance(5000);
    expect(calls.poll[1]).toEqual({ device_code: 'device-code-2' });
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it.each(['expired', 'consumed', 'canceled'] as const)(
    'offers a new code when the poll says %s',
    async (status) => {
      const calls = mockServer({ polls: () => HttpResponse.json(devicePoll({ status })) });
      setup();
      await advance(0);
      await advance(5000);
      expect(screen.getByTestId('signin-expired')).toHaveTextContent('The code has expired.');
      fireEvent.click(screen.getByRole('button', { name: 'New code' }));
      await advance(0);
      expect(calls.start).toHaveLength(2);
      expect(screen.getByTestId('user-code')).toBeInTheDocument();
    },
  );

  it('expires on its own when the local deadline passes without an answer', async () => {
    const calls = mockServer({
      starts: [deviceStart({ expires_at: new Date(Date.now() + 8000).toISOString() })],
    });
    setup();
    await advance(0);
    await advance(5000);
    expect(calls.poll).toHaveLength(1);
    await advance(5000);
    expect(screen.getByTestId('signin-expired')).toBeInTheDocument();
    expect(calls.poll).toHaveLength(1);
  });

  it('moves its local deadline to the expires_at of a pending answer', async () => {
    const calls = mockServer({
      starts: [deviceStart({ expires_at: new Date(Date.now() + 8000).toISOString() })],
      polls: () =>
        HttpResponse.json(devicePoll({ expires_at: new Date(Date.now() + 300_000).toISOString() })),
    });
    setup();
    await advance(0);
    await advance(5000);
    await advance(5000);
    expect(screen.queryByTestId('signin-expired')).not.toBeInTheDocument();
    expect(calls.poll).toHaveLength(2);
  });

  it('cancels the code and stops polling when the user presses Back', async () => {
    const calls = mockServer();
    const { onBack } = setup();
    await advance(0);
    await advance(5000);
    expect(calls.poll).toHaveLength(1);

    fireEvent.keyDown(window, { keyCode: 461 });
    await advance(0);
    expect(calls.cancel).toEqual([{ device_code: 'device-code-1' }]);
    expect(onBack).toHaveBeenCalledTimes(1);
    await advance(30000);
    expect(calls.poll).toHaveLength(1);
  });

  it('cancels the code with the on-screen "Change server" button too', async () => {
    const calls = mockServer();
    const { onBack } = setup();
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Change server' }));
    await advance(0);
    expect(calls.cancel).toHaveLength(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offers no password sign-in when the server does not allow it', async () => {
    mockServer({ providers: authProviders([], false) });
    setup();
    await advance(0);
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with password' })).not.toBeInTheDocument();
  });

  it('offers "Sign in with password" below the code when the server allows it', async () => {
    mockServer({ providers: authProviders() });
    const { onPassword } = setup();
    await advance(0);
    const button = screen.getByRole('button', { name: 'Sign in with password' });
    // The code stays first on the screen.
    expect(
      screen.getByTestId('user-code').compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(onPassword).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onPassword).toHaveBeenCalledTimes(1);
    // Let the withdrawal of the code finish, so it does not leak into the next test.
    await advance(0);
  });

  it('withdraws the pending code when the user opens the password screen', async () => {
    const calls = mockServer({ providers: authProviders() });
    setup();
    await advance(0);
    await advance(5000);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    await advance(0);
    expect(calls.cancel).toEqual([{ device_code: 'device-code-1' }]);
    await advance(30000);
    expect(calls.poll).toHaveLength(1);
  });

  it('offers the password and gives it the focus when the server has no code sign-in', async () => {
    mockServer({
      providers: authProviders(),
      capabilityBody: { ...capability, state: 'disabled' },
    });
    setup();
    await advance(0);
    expect(screen.getByTestId('signin-unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with password' })).toHaveFocus();
  });

  it('does not send a cancel for a code that already ended', async () => {
    const calls = mockServer({ polls: () => HttpResponse.json(devicePoll({ status: 'denied' })) });
    const { onBack } = setup();
    await advance(0);
    await advance(5000);
    fireEvent.keyDown(window, { keyCode: 461 });
    await advance(0);
    expect(calls.cancel).toHaveLength(0);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('stops polling when it unmounts', async () => {
    const calls = mockServer();
    const { unmount } = setup();
    await advance(0);
    await advance(5000);
    expect(calls.poll).toHaveLength(1);
    unmount();
    await advance(60000);
    expect(calls.poll).toHaveLength(1);
    expect(calls.cancel).toHaveLength(0);
  });

  it('says so when the server does not offer code sign-in, and starts no code', async () => {
    const calls = mockServer({ capabilityBody: { ...capability, state: 'disabled' } });
    setup();
    await advance(0);
    expect(screen.getByTestId('signin-unavailable')).toHaveTextContent(
      'This server does not offer sign-in with a code.',
    );
    expect(calls.start).toHaveLength(0);
  });

  it('shows an error with Try again when starting the code fails, and retries', async () => {
    const calls = mockServer({
      starts: [],
    });
    server.use(
      http.post(`${BASE_URL}/api/v2/auth/device/start`, () => HttpResponse.error(), { once: true }),
    );
    setup();
    await advance(0);
    expect(screen.getByTestId('signin-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
    expect(calls.start).toHaveLength(1);
  });

  it('gives up with an error after repeated poll failures', async () => {
    mockServer({ polls: () => HttpResponse.error() });
    setup();
    await advance(0);
    for (let i = 0; i < 6; i++) await advance(5000);
    expect(screen.getByTestId('signin-error')).toBeInTheDocument();
  });

  it('keeps the code through a single failed poll', async () => {
    mockServer({
      polls: (n) => (n === 1 ? HttpResponse.error() : HttpResponse.json(devicePoll())),
    });
    setup();
    await advance(0);
    await advance(5000);
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
    expect(screen.queryByTestId('signin-error')).not.toBeInTheDocument();
  });
});

describe('SignInScreen QR code and cancel capability', () => {
  const pathOf = (value: string) => {
    const { unmount } = render(<QrCode value={value} label="qr" />);
    const d = screen.getByTestId('qr').querySelector('path')?.getAttribute('d');
    unmount();
    return d;
  };

  it('encodes verification_uri_complete, not verification_uri', async () => {
    mockServer({
      starts: [
        deviceStart({
          verification_uri: 'https://silo.example.test/activate',
          verification_uri_complete: 'https://silo.example.test/activate?code=48217730',
        }),
      ],
    });
    const view = setup();
    await advance(0);
    const shown = screen.getByTestId('qr').querySelector('path')?.getAttribute('d');
    view.unmount();
    expect(shown).toBe(pathOf('https://silo.example.test/activate?code=48217730'));
    expect(shown).not.toBe(pathOf('https://silo.example.test/activate'));
  });

  it('keeps a 4-module quiet zone: viewBox is size + 8 and modules start at 4,4', () => {
    const value = 'https://silo.example.test/activate?code=48217730';
    render(<QrCode value={value} label="qr" />);
    const qr = screen.getByTestId('qr');
    const size = encode(value, { ecc: 'M', border: 0 }).size;
    expect(qr.getAttribute('viewBox')).toBe(`0 0 ${size + 8} ${size + 8}`);
    expect(qr.querySelector('rect')).toHaveAttribute('width', String(size + 8));
    // The top-left finder pattern always starts with a dark module.
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M4 4h/);
  });

  it('sends no cancel on Back when the server does not support cancel', async () => {
    const calls = mockServer({ capabilityBody: { ...capability, cancel: false } });
    const { onBack } = setup();
    await advance(0);
    expect(screen.getByTestId('user-code')).toBeInTheDocument();
    fireEvent.keyDown(window, { keyCode: 461 });
    await advance(0);
    expect(calls.cancel).toHaveLength(0);
    expect(onBack).toHaveBeenCalledTimes(1);
    await advance(30000);
    expect(calls.poll).toHaveLength(0);
  });
});
