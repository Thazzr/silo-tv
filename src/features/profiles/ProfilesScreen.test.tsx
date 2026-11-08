import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account, problem } from '../../test/apiFixtures';
import { profile, profileCollection } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { ProfilesScreen } from './ProfilesScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function signedIn() {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
  });
  return session;
}

function listProfiles(items: ReturnType<typeof profile>[]) {
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () => HttpResponse.json(profileCollection(items))),
  );
}

function setup(options: { autoSelect?: boolean } = {}) {
  const onSelected = vi.fn();
  const session = signedIn();
  const view = renderWithSilo(
    <ProfilesScreen autoSelect={options.autoSelect ?? true} onSelected={onSelected} />,
    { session },
  );
  return { onSelected, ...view };
}

const two = [
  profile({ id: 'p1', name: 'alex' }),
  profile({ id: 'p2', name: 'Sam', has_pin: true, is_primary: false }),
];

/** Opens the PIN prompt of "Sam". */
async function openPin() {
  fireEvent.click(await screen.findByRole('button', { name: /Sam/ }));
  await screen.findByTestId('pin-entry');
}

function verifyPin(valid: boolean, token?: string) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${BASE_URL}/api/v2/profiles/p2/verify-pin`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({
        valid,
        expires_at: null,
        ...(token ? { profile_token: token } : {}),
      });
    }),
  );
  return bodies;
}

const typeDigits = (digits: string) => {
  for (const d of digits) fireEvent.keyDown(window, { key: d, keyCode: 48 + Number(d) });
};

describe('ProfilesScreen', () => {
  it('shows a loading cue while the profiles load', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/profiles`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(profileCollection(two));
      }),
    );
    setup();
    expect(screen.getByTestId('loading')).toHaveTextContent('Loading profiles');
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
  });

  it('selects a single profile without a PIN automatically', async () => {
    listProfiles([profile({ id: 'p1' })]);
    const { onSelected, session } = setup();
    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(session.get()).toMatchObject({ profileId: 'p1' });
    expect(session.get()?.profileToken).toBeUndefined();
    expect(screen.queryByTestId('profile-list')).not.toBeInTheDocument();
  });

  it('shows the list for a single profile when auto-select is off', async () => {
    listProfiles([profile({ id: 'p1', name: 'Alex' })]);
    const { onSelected } = setup({ autoSelect: false });
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('does not auto-select a single profile that has a PIN', async () => {
    listProfiles([profile({ id: 'p1', has_pin: true })]);
    const { onSelected } = setup();
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('lists several profiles with an avatar initial and a PIN marker', async () => {
    listProfiles(two);
    setup();
    const list = await screen.findByTestId('profile-list');
    expect(list.querySelectorAll('button')).toHaveLength(2);
    expect(list).toHaveTextContent('A');
    expect(list).toHaveTextContent('alex');
    expect(screen.getByRole('button', { name: /Sam/ })).toHaveTextContent('PIN');
    expect(screen.getByRole('button', { name: /alex/ })).not.toHaveTextContent('PIN');
    // The first profile has the focus, so Enter on the remote picks it.
    expect(screen.getByRole('button', { name: /alex/ })).toHaveFocus();
  });

  it('selects a profile without a PIN on click', async () => {
    listProfiles(two);
    const { onSelected, session } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /alex/ }));
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(session.get()).toMatchObject({ profileId: 'p1' });
  });

  it('ignores Back on the list', async () => {
    listProfiles(two);
    setup();
    await screen.findByTestId('profile-list');
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(screen.getByTestId('profile-list')).toBeInTheDocument();
  });

  it.each([
    ['succeeds', () => new HttpResponse(null, { status: 204 })],
    ['fails', () => HttpResponse.error()],
  ])('Sign out clears the session when logout %s', async (_name, answer) => {
    listProfiles(two);
    let auth: string | null = null;
    server.use(
      http.post(`${BASE_URL}/api/v2/auth/logout`, ({ request }) => {
        auth = request.headers.get('Authorization');
        return answer();
      }),
    );
    const { session } = setup();
    await screen.findByTestId('profile-list');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(session.get()).toBeNull());
    expect(auth).toBe('Bearer a');
  });

  it('shows an error with Try again when the profiles cannot be loaded', async () => {
    server.use(
      http.get(
        `${BASE_URL}/api/v2/profiles`,
        () => HttpResponse.json(problem('internal', 500), { status: 500 }),
        {
          once: true,
        },
      ),
    );
    setup();
    expect(await screen.findByTestId('error-state')).toHaveTextContent('could not be loaded');
    listProfiles(two);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it('says when the account has no profile', async () => {
    listProfiles([]);
    setup();
    expect(await screen.findByText('This account has no profile.')).toBeInTheDocument();
  });
});

describe('PIN entry', () => {
  it('takes the PIN from the remote number keys and verifies it', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 'pvt_abc');
    const { onSelected, session } = setup();
    await openPin();
    typeDigits('1234');
    expect(screen.getByTestId('pin-dots')).toHaveTextContent('••••');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(bodies).toEqual([{ pin: '1234' }]);
    expect(session.get()).toMatchObject({ profileId: 'p2', profileToken: 'pvt_abc' });
  });

  it('takes the PIN from the on-screen digit pad', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 'pvt_pad');
    const { onSelected, session } = setup();
    await openPin();
    for (const digit of ['9', '0', '7']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(bodies).toEqual([{ pin: '907' }]);
    expect(session.get()?.profileToken).toBe('pvt_pad');
  });

  it('deletes the last digit with the Delete key of the pad', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 'pvt_x');
    setup();
    await openPin();
    typeDigits('125');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    typeDigits('3');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bodies).toEqual([{ pin: '123' }]));
  });

  it('is operable with arrows and Enter only (digit pad grid)', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 'pvt_x');
    setup();
    await openPin();
    // Focus starts on "1"; Down moves a row (to "4"), Right to "5".
    await waitFor(() => expect(screen.getByRole('button', { name: '1' })).toHaveFocus());
    await pressKey(KEY.down);
    await pressKey(KEY.right);
    expect(screen.getByRole('button', { name: '5' })).toHaveFocus();
    await pressKey(KEY.enter);
    expect(screen.getByTestId('pin-dots')).toHaveTextContent('•');
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    await pressKey(KEY.down);
    // "5" is in the middle column: Down reaches "8", then "0" in the last row (the third Down stays
    // there, the grid ends), and Right moves on to OK.
    await pressKey(KEY.right);
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    await pressKey(KEY.enter);
    await waitFor(() => expect(bodies).toEqual([{ pin: '5' }]));
  });

  it('shows the wrong-PIN message, clears the entry and stays on the PIN screen', async () => {
    listProfiles(two);
    verifyPin(false);
    const { onSelected, session } = setup();
    await openPin();
    typeDigits('0000');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByTestId('pin-message')).toHaveTextContent('Wrong PIN');
    expect(screen.getByTestId('pin-dots')).toHaveTextContent('–');
    expect(onSelected).not.toHaveBeenCalled();
    expect(session.get()?.profileId).toBeUndefined();
  });

  it.each([
    ['300', 'Try again in 5 min.'],
    ['45', 'Try again in 45 s.'],
  ])('shows the lockout with the wait time for Retry-After %s', async (retryAfter, text) => {
    listProfiles(two);
    server.use(
      http.post(`${BASE_URL}/api/v2/profiles/p2/verify-pin`, () =>
        HttpResponse.json(problem('rate_limited', 429), {
          status: 429,
          headers: { 'Retry-After': retryAfter },
        }),
      ),
    );
    const { onSelected } = setup();
    await openPin();
    typeDigits('1111');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByTestId('pin-message')).toHaveTextContent(text);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it('does not replay a failed check by itself', async () => {
    listProfiles(two);
    let calls = 0;
    server.use(
      http.post(`${BASE_URL}/api/v2/profiles/p2/verify-pin`, () => {
        calls += 1;
        return HttpResponse.json(problem('internal', 503), { status: 503 });
      }),
    );
    setup();
    await openPin();
    typeDigits('1111');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByTestId('pin-message')).toHaveTextContent('could not be checked');
    expect(calls).toBe(1);
  });

  it('sends nothing without digits', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 't');
    setup();
    await openPin();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bodies).toEqual([]);
  });

  it('returns from the PIN prompt to the list with Back, not out of the screen', async () => {
    listProfiles(two);
    const { session } = setup();
    await openPin();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    expect(session.get()).not.toBeNull();
  });
});

describe('PIN entry key sources and length', () => {
  it('accepts digits that arrive with keyCode only (top row and numpad)', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 't');
    setup();
    await openPin();
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 49 });
    fireEvent.keyDown(window, { keyCode: 97 });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 48 });
    fireEvent.keyDown(window, { keyCode: 105 });
    expect(screen.getByTestId('pin-dots')).toHaveTextContent('••••');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bodies).toEqual([{ pin: '1109' }]));
  });

  it('caps the PIN at 12 digits, on screen and in the request', async () => {
    listProfiles(two);
    const bodies = verifyPin(true, 't');
    setup();
    await openPin();
    typeDigits('123456789012345');
    expect(screen.getByTestId('pin-dots').textContent).toBe('•'.repeat(12));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(bodies).toEqual([{ pin: '123456789012' }]));
  });
});
