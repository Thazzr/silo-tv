import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { BASE_URL, account } from '../../test/apiFixtures';
import { profile, profileCollection } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { avatarColor } from './avatar';
import { ProfilesScreen } from './ProfilesScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function listProfiles(items: ReturnType<typeof profile>[]) {
  server.use(
    http.get(`${BASE_URL}/api/v2/profiles`, () => HttpResponse.json(profileCollection(items))),
  );
}

function setup(options: { initialFocusId?: string | null } = {}) {
  const onSelected = vi.fn();
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
  });
  const view = renderWithSilo(
    <ProfilesScreen
      autoSelect={false}
      initialFocusId={options.initialFocusId}
      onSelected={onSelected}
    />,
    { session },
  );
  return { onSelected, ...view };
}

const tile = (name: RegExp) => screen.getByRole('button', { name });

describe('profile picker tiles', () => {
  it('shows an avatar image when the profile has one and a coloured initial otherwise', async () => {
    listProfiles([
      profile({
        id: 'p1',
        name: 'Fox',
        avatar: 'preset:fox',
        avatar_source: 'preset',
        avatar_url: '/avatars/presets/fox.png',
      }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    const image = tile(/Fox/).querySelector('img');
    expect(image).toHaveAttribute('src', `${BASE_URL}/avatars/presets/fox.png`);
    expect(tile(/Fox/).querySelector('[data-testid="profile-avatar-initial"]')).toBeNull();
    const initial = tile(/Sam/).querySelector<HTMLElement>(
      '[data-testid="profile-avatar-initial"]',
    );
    expect(initial).toHaveTextContent('S');
    expect(initial).toHaveStyle({ background: avatarColor('p2') });
    expect(tile(/Sam/).querySelector('img')).toBeNull();
  });

  it('falls back to the initial when the avatar image cannot be loaded', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Fox', avatar_url: '/avatars/presets/fox.png' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    fireEvent.error(tile(/Fox/).querySelector('img')!);
    expect(tile(/Fox/).querySelector('img')).toBeNull();
    expect(tile(/Fox/)).toHaveTextContent('F');
  });

  it('never loads an avatar reference that is not an http(s) URL', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Fox', avatar_url: 'javascript:alert(1)' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    expect(tile(/Fox/).querySelector('img')).toBeNull();
  });

  it('marks PIN profiles with a lock and child profiles with a Kids badge', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', has_pin: true, is_primary: false }),
      profile({ id: 'p3', name: 'Mia', is_child: true, is_primary: false }),
      profile({ id: 'p4', name: 'Max', is_child: true, has_pin: true, is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    const has = (name: RegExp, id: string) => tile(name).querySelector(`[data-testid="${id}"]`);
    expect(has(/Alex/, 'lock-badge')).toBeNull();
    expect(has(/Alex/, 'kids-badge')).toBeNull();
    expect(has(/Sam/, 'lock-badge')).not.toBeNull();
    expect(has(/Sam/, 'kids-badge')).toBeNull();
    expect(has(/Mia/, 'kids-badge')).toHaveTextContent('Kids');
    expect(has(/Mia/, 'lock-badge')).toBeNull();
    expect(has(/Max/, 'lock-badge')).not.toBeNull();
    expect(has(/Max/, 'kids-badge')).not.toBeNull();
    // The lock is named for screen readers too.
    expect(screen.getAllByLabelText('PIN', { selector: 'svg' })).toHaveLength(2);
  });

  it('shows Add profile as the last tile when the account has a primary profile', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    const list = await screen.findByTestId('profile-list');
    const names = Array.from(list.querySelectorAll('button')).map((b) => b.textContent);
    expect(names[names.length - 1]).toContain('Add profile');
    expect(names).toHaveLength(3);
  });

  it('hides Add profile when no profile of the account is the primary one', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex', is_primary: false }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    const list = await screen.findByTestId('profile-list');
    expect(list.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add profile' })).not.toBeInTheDocument();
  });

  it('marks the focused tile with the scale class and moves it with the arrow keys', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup();
    await screen.findByTestId('profile-list');
    await waitFor(() => expect(tile(/Alex/)).toHaveFocus());
    expect(tile(/Alex/)).toHaveClass('is-focused');
    expect(tile(/Sam/)).not.toHaveClass('is-focused');
    await pressKey(KEY.right);
    expect(tile(/Sam/)).toHaveFocus();
    expect(tile(/Sam/)).toHaveClass('is-focused');
    expect(tile(/Alex/)).not.toHaveClass('is-focused');
    await pressKey(KEY.right);
    expect(screen.getByRole('button', { name: 'Add profile' })).toHaveClass('is-focused');
    // Down leaves the row for Sign out: no tile keeps the class.
    await pressKey(KEY.down);
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus();
    expect(document.querySelector('.profile-tile.is-focused')).toBeNull();
  });

  it('starts on the profile that was chosen last on this device', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup({ initialFocusId: 'p2' });
    await screen.findByTestId('profile-list');
    await waitFor(() => expect(tile(/Sam/)).toHaveFocus());
  });

  it('starts on the first profile when the remembered one no longer exists', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    setup({ initialFocusId: 'gone' });
    await screen.findByTestId('profile-list');
    await waitFor(() => expect(tile(/Alex/)).toHaveFocus());
  });

  it('reports a picked profile as chosen through the picker, with its PIN flag', async () => {
    listProfiles([
      profile({ id: 'p1', name: 'Alex' }),
      profile({ id: 'p2', name: 'Sam', is_primary: false }),
    ]);
    const { onSelected } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Sam/ }));
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(onSelected.mock.calls[0]![0]).toMatchObject({ id: 'p2', has_pin: false });
    expect(onSelected.mock.calls[0]![1]).toBe(true);
  });
});
