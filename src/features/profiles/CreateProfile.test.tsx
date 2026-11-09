import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account, problem } from '../../test/apiFixtures';
import { profile, profileCollection } from '../../test/flowFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { ProfilesScreen } from './ProfilesScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let stored: ReturnType<typeof profile>[] = [];

/** The household as the server holds it; a created profile is appended to it. */
function household(items: ReturnType<typeof profile>[]) {
  stored = [...items];
  const reads = { count: 0 };
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () => {
      reads.count += 1;
      return HttpResponse.json(profileCollection(stored));
    }),
  );
  return reads;
}

interface Created {
  body: Record<string, unknown>;
  profileId: string | null;
  profileToken: string | null;
}

function acceptCreate(overrides: Partial<ReturnType<typeof profile>> = {}) {
  const seen: Created[] = [];
  server.use(
    http.post(`${BASE_URL}/api/v2/profiles`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      seen.push({
        body,
        profileId: request.headers.get('X-Profile-Id'),
        profileToken: request.headers.get('X-Profile-Token'),
      });
      const created = profile({
        id: 'new-1',
        name: String(body.name),
        has_pin: Boolean(body.pin),
        is_child: body.is_child === true,
        is_primary: false,
        ...overrides,
      });
      stored.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
  );
  return seen;
}

function refuseCreate(status: number, code: string) {
  server.use(
    http.post(`${BASE_URL}/api/v2/profiles`, () =>
      HttpResponse.json(problem(code, status), { status }),
    ),
  );
}

function setup() {
  const onSelected = vi.fn();
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
  });
  const view = renderWithSilo(<ProfilesScreen autoSelect={false} onSelected={onSelected} />, {
    session,
  });
  return { onSelected, ...view };
}

const twoProfiles = [
  profile({ id: 'p1', name: 'Alex' }),
  profile({ id: 'p2', name: 'Sam', is_primary: false }),
];

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add profile' }));
  await screen.findByTestId('create-profile');
}

const nameField = () => screen.getByLabelText('Profile name');
const pinField = () => screen.getByLabelText(/^PIN/);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));
const typeName = (value: string) => fireEvent.change(nameField(), { target: { value } });
const typePin = (value: string) => fireEvent.change(pinField(), { target: { value } });

describe('create profile', () => {
  it('opens the form from the Add profile tile and leaves it with Cancel and with Back', async () => {
    household(twoProfiles);
    setup();
    await openForm();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New profile');
    // The field takes the focus in an effect after the form is on screen.
    await waitFor(() => expect(nameField()).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
    // The focus returns to the tile that opened the form.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add profile' })).toHaveFocus());
    await openForm();
    fireEvent.keyDown(window, { keyCode: 461 });
    expect(await screen.findByTestId('profile-list')).toBeInTheDocument();
  });

  it('asks for a name and sends nothing without one', async () => {
    household(twoProfiles);
    const seen = acceptCreate();
    setup();
    await openForm();
    typeName('   ');
    save();
    expect(await screen.findByTestId('create-error')).toHaveTextContent('Enter a name');
    expect(nameField()).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toEqual([]);
  });

  it.each(['1', '123', '123456789'])(
    'refuses the PIN "%s" that is not 4 to 8 digits and sends nothing',
    async (pin) => {
      household(twoProfiles);
      const seen = acceptCreate();
      setup();
      await openForm();
      typeName('Mia');
      typePin(pin);
      save();
      expect(await screen.findByTestId('create-error')).toHaveTextContent('4 to 8 digits');
      expect(pinField()).toHaveFocus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(seen).toEqual([]);
    },
  );

  it('keeps only digits in the PIN field', async () => {
    household(twoProfiles);
    setup();
    await openForm();
    typePin('12ab-34');
    expect(pinField()).toHaveValue('1234');
  });

  it('creates the profile as the primary one and focuses the new tile', async () => {
    household(twoProfiles);
    const seen = acceptCreate();
    const { onSelected, session } = setup();
    await openForm();
    typeName('  Mia  ');
    typePin('4321');
    fireEvent.click(screen.getByRole('switch', { name: /Kids profile/ }));
    expect(screen.getByRole('switch', { name: /Kids profile/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    save();
    const tile = await screen.findByRole('button', { name: /Mia/ });
    await waitFor(() => expect(tile).toHaveFocus());
    expect(seen).toEqual([
      {
        body: { name: 'Mia', pin: '4321', is_child: true },
        profileId: 'p1',
        profileToken: null,
      },
    ]);
    expect(tile.querySelector('[data-testid="kids-badge"]')).not.toBeNull();
    expect(tile.querySelector('[data-testid="lock-badge"]')).not.toBeNull();
    // Creating chooses nothing: no profile is open.
    expect(onSelected).not.toHaveBeenCalled();
    expect(session.get()?.profileId).toBeUndefined();
  });

  it('shows the age-limit hint only while the kids switch is on', async () => {
    household(twoProfiles);
    setup();
    await openForm();
    expect(screen.queryByTestId('kids-hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /Kids profile/ }));
    expect(screen.getByTestId('kids-hint')).toHaveTextContent(
      "Set age limits for this profile in Silo's web app.",
    );
    fireEvent.click(screen.getByRole('switch', { name: /Kids profile/ }));
    expect(screen.queryByTestId('kids-hint')).not.toBeInTheDocument();
  });

  it('sends no PIN and a non-kids profile by default', async () => {
    household(twoProfiles);
    const seen = acceptCreate();
    setup();
    await openForm();
    typeName('Pat');
    save();
    await screen.findByRole('button', { name: /Pat/ });
    expect(seen[0]!.body).toEqual({ name: 'Pat', is_child: false });
  });

  it('asks for the PIN of a PIN-locked primary profile first and sends its proof', async () => {
    household([
      profile({ id: 'p1', name: 'Alex', has_pin: true }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    const seen = acceptCreate();
    const verified: unknown[] = [];
    server.use(
      http.post(`${BASE_URL}/api/v2/profiles/p1/verify-pin`, async ({ request }) => {
        verified.push(await request.json());
        return HttpResponse.json({ valid: true, expires_at: null, profile_token: 'pvt_primary' });
      }),
    );
    const { onSelected, session } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add profile' }));
    await screen.findByTestId('pin-entry');
    for (const d of '2468') fireEvent.keyDown(window, { key: d, keyCode: 48 + Number(d) });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByTestId('create-profile');
    typeName('Mia');
    save();
    await screen.findByRole('button', { name: /Mia/ });
    expect(verified).toEqual([{ pin: '2468' }]);
    expect(seen[0]).toMatchObject({ profileId: 'p1', profileToken: 'pvt_primary' });
    // The proof was for creating only: nothing was opened and nothing is kept in the session.
    expect(onSelected).not.toHaveBeenCalled();
    expect(session.get()?.profileId).toBeUndefined();
    expect(session.get()?.profileToken).toBeUndefined();
  });

  it.each([
    ['a taken name', 409, 'conflict', 'A profile with this name already exists.'],
    ['a full household', 422, 'profile_limit', 'This account cannot have more profiles.'],
    ['a missing right', 403, 'permission_denied', 'Only the main profile'],
    ['too many attempts', 429, 'rate_limited', 'Too many attempts'],
    ['another refusal', 500, 'internal', 'could not be created'],
  ])('shows the reason for %s and stays on the form', async (_name, status, code, text) => {
    household(twoProfiles);
    refuseCreate(status, code);
    setup();
    await openForm();
    typeName('Sam');
    save();
    expect(await screen.findByTestId('create-error')).toHaveTextContent(text);
    expect(screen.getByTestId('create-profile')).toBeInTheDocument();
    // The typed values are kept for another try.
    expect(nameField()).toHaveValue('Sam');
  });

  it('goes back to the PIN prompt when the server refuses the primary profile proof', async () => {
    household([
      profile({ id: 'p1', name: 'Alex', has_pin: true }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    refuseCreate(403, 'profile_verification_required');
    server.use(
      http.post(`${BASE_URL}/api/v2/profiles/p1/verify-pin`, () =>
        HttpResponse.json({ valid: true, expires_at: null, profile_token: 'pvt_old' }),
      ),
    );
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add profile' }));
    await screen.findByTestId('pin-entry');
    fireEvent.keyDown(window, { key: '1', keyCode: 49 });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByTestId('create-profile');
    typeName('Mia');
    save();
    expect(await screen.findByTestId('pin-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('create-profile')).not.toBeInTheDocument();
  });

  it('reads the list again and says so when the server gives no answer', async () => {
    const reads = household(twoProfiles);
    server.use(http.post(`${BASE_URL}/api/v2/profiles`, () => HttpResponse.error()));
    setup();
    await openForm();
    typeName('Mia');
    save();
    expect(await screen.findByTestId('create-error')).toHaveTextContent('may have been created');
    await waitFor(() => expect(reads.count).toBeGreaterThan(1));
  });

  it('does not send the create twice while it is pending', async () => {
    household(twoProfiles);
    let posts = 0;
    server.use(
      http.post(`${BASE_URL}/api/v2/profiles`, async () => {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return HttpResponse.json(profile({ id: 'new-1', name: 'Mia', is_primary: false }), {
          status: 201,
        });
      }),
    );
    setup();
    await openForm();
    typeName('Mia');
    // Enter in a field submits the form even while the button is disabled.
    fireEvent.submit(screen.getByTestId('create-profile'));
    fireEvent.submit(screen.getByTestId('create-profile'));
    await screen.findByRole('button', { name: /Mia/ });
    expect(posts).toBe(1);
  });

  it('has no Add profile tile to open when only non-primary profiles exist', async () => {
    household([
      profile({ id: 'p1', name: 'Alex', is_primary: false }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    expect(screen.queryByRole('button', { name: 'Add profile' })).not.toBeInTheDocument();
  });
});
