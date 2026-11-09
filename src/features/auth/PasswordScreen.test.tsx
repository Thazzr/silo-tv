import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, problemResponse } from '../../test/apiFixtures';
import { authProvider, authProviders, tokenPair } from '../../test/flowFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { PasswordScreen } from './PasswordScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

// Obviously fake values; the tests look for them in logs and storage.
const USER = 'test-viewer';
const PASS = 'fake-password-0000';

interface LoginCall {
  body: Record<string, unknown>;
}

function serve(
  options: {
    providers?: ReturnType<typeof authProviders>;
    login?: (call: LoginCall) => Response;
  } = {},
) {
  const logins: LoginCall[] = [];
  server.use(
    http.get(`${BASE_URL}/api/v2/auth/providers`, () =>
      HttpResponse.json(options.providers ?? authProviders()),
    ),
    http.post(`${BASE_URL}/api/v2/auth/login`, async ({ request }) => {
      const call = { body: (await request.json()) as Record<string, unknown> };
      logins.push(call);
      return options.login?.(call) ?? HttpResponse.json(tokenPair);
    }),
  );
  return logins;
}

function setup() {
  const storage = memoryStorage();
  const session = new Session(storage);
  const onSignedIn = vi.fn();
  const onBack = vi.fn();
  const view = renderWithSilo(<PasswordScreen onSignedIn={onSignedIn} onBack={onBack} />, {
    session,
  });
  return { ...view, session, storage, onSignedIn, onBack };
}

async function fillIn(user = USER, pass = PASS) {
  await userEvent.type(screen.getByLabelText('Username'), user);
  await userEvent.type(screen.getByLabelText('Password'), pass);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

describe('PasswordScreen', () => {
  it('has a username field and a password field of type password, and focuses the username', async () => {
    serve();
    setup();
    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await waitFor(() => expect(username).toHaveFocus());
  });

  it("signs in with username and password and stores the tokens in this server's session", async () => {
    const logins = serve();
    const { session, onSignedIn } = setup();
    await fillIn();
    await submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(logins).toEqual([{ body: { username: USER, password: PASS } }]);
    expect(session.get()).toMatchObject({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      user: { username: 'viewer' },
    });
  });

  it('shows no provider picker for a single credential provider, and names no provider', async () => {
    const logins = serve({ providers: authProviders([authProvider()]) });
    const { onSignedIn } = setup();
    await fillIn();
    await submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(screen.queryByTestId('provider-picker')).not.toBeInTheDocument();
    expect(logins[0]!.body).not.toHaveProperty('provider');
  });

  it('ignores providers that are not credential providers when counting the choices', async () => {
    serve({
      providers: authProviders([
        authProvider(),
        authProvider({ id: 'sso', display_name: 'Company SSO', mode: 'oauth', default: false }),
      ]),
    });
    setup();
    await screen.findByLabelText('Username');
    // Give the providers request time to arrive before checking for the absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('provider-picker')).not.toBeInTheDocument();
  });

  it('shows a provider picker for several credential providers, starting on the default, and sends the chosen one', async () => {
    const logins = serve({
      providers: authProviders([
        authProvider({ id: 'local', display_name: 'Silo account', default: false }),
        authProvider({ id: 'ldap', display_name: 'Company directory', default: true }),
      ]),
    });
    const { onSignedIn } = setup();
    const picker = await screen.findByTestId('provider-picker');
    expect(picker).toHaveAttribute('role', 'radiogroup');
    const directory = screen.getByRole('radio', { name: /Company directory/ });
    const local = screen.getByRole('radio', { name: /Silo account/ });
    expect(directory).toHaveAttribute('aria-checked', 'true');
    expect(local).toHaveAttribute('aria-checked', 'false');

    await fillIn();
    await submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(logins[0]!.body).toEqual({ username: USER, password: PASS, provider: 'ldap' });
  });

  it('sends the provider the user picked instead of the default', async () => {
    const logins = serve({
      providers: authProviders([
        authProvider({ id: 'local', display_name: 'Silo account', default: false }),
        authProvider({ id: 'ldap', display_name: 'Company directory', default: true }),
      ]),
    });
    const { onSignedIn } = setup();
    fireEvent.click(await screen.findByRole('radio', { name: /Silo account/ }));
    expect(screen.getByRole('radio', { name: /Silo account/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Company directory/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await fillIn();
    await submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(logins[0]!.body.provider).toBe('local');
  });

  it('says so for wrong credentials, clears the password field, keeps the name and the session empty', async () => {
    serve({ login: () => problemResponse('invalid_credentials', 401) });
    const { session, onSignedIn } = setup();
    await fillIn();
    await submit();
    expect(await screen.findByTestId('password-error')).toHaveTextContent(
      'Wrong username or password.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Username')).toHaveValue(USER);
    expect(session.get()).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
    // The next attempt can start right away in the password field.
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveFocus());
  });

  it('shows how long to wait when the name is locked (429 with Retry-After)', async () => {
    serve({
      login: () => problemResponse('rate_limited', 429, { 'Retry-After': '600' }),
    });
    setup();
    await fillIn();
    await submit();
    expect(await screen.findByTestId('password-error')).toHaveTextContent(
      'Too many attempts. Try again in 10 min.',
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('shows seconds for a short wait, and a general text without Retry-After', async () => {
    let answer = () => problemResponse('rate_limited', 429, { 'Retry-After': '30' });
    serve({ login: () => answer() });
    setup();
    await fillIn();
    await submit();
    expect(await screen.findByTestId('password-error')).toHaveTextContent(
      'Too many attempts. Try again in 30 s.',
    );
    answer = () => problemResponse('rate_limited', 429);
    await fillIn();
    await submit();
    await waitFor(() =>
      expect(screen.getByTestId('password-error')).toHaveTextContent(
        'Too many attempts. Try again later.',
      ),
    );
  });

  it.each([
    [
      'provider_unavailable',
      503,
      'The sign-in service of this server is not available. Try again later.',
    ],
    ['dependency_unavailable', 503, 'The server could not sign you in. Try again later.'],
    ['internal_error', 500, 'The server could not sign you in. Try again later.'],
    ['permission_denied', 403, 'This account cannot sign in with a password.'],
  ])('maps the problem %s (%i) to its own message', async (code, status, text) => {
    serve({ login: () => problemResponse(code, status) });
    setup();
    await fillIn();
    await submit();
    expect(await screen.findByTestId('password-error')).toHaveTextContent(text);
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('says the server could not sign in when the request fails outright', async () => {
    serve({ login: () => HttpResponse.error() });
    setup();
    await fillIn();
    await submit();
    expect(await screen.findByTestId('password-error')).toHaveTextContent(
      'The server could not sign you in. Try again later.',
    );
  });

  it('does not repeat a refused attempt by itself', async () => {
    const logins = serve({ login: () => problemResponse('internal_error', 500) });
    setup();
    await fillIn();
    await submit();
    await screen.findByTestId('password-error');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(logins).toHaveLength(1);
  });

  it('never logs the password and never stores it, on success and on failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    let refuse = true;
    serve({
      login: () =>
        refuse ? problemResponse('invalid_credentials', 401) : HttpResponse.json(tokenPair),
    });
    const { storage, session, queryClient, onSignedIn } = setup();
    await fillIn();
    await submit();
    await screen.findByTestId('password-error');
    refuse = false;
    await fillIn();
    await submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(PASS);
    // The session's own storage, the browser's storage and React Query's caches.
    const stored = JSON.stringify([
      storage.get('silo-tv.session.v1'),
      { ...localStorage },
      { ...sessionStorage },
      session.get(),
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
    ]);
    expect(stored).not.toContain(PASS);
  });

  it('does nothing but move the focus when a field is empty', async () => {
    const logins = serve();
    setup();
    // Enter in the empty username field: nothing to send, the focus stays on the username.
    await userEvent.type(screen.getByLabelText('Username'), '{Enter}');
    expect(logins).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus());
    // With a name but no password the password field gets the focus.
    await userEvent.type(screen.getByLabelText('Username'), USER);
    await submit();
    expect(logins).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveFocus());
  });

  it('leaves through Back', async () => {
    serve();
    const { onBack } = setup();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
