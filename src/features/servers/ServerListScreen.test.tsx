import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServerRegistry } from '../../app/servers';
import { account } from '../../test/apiFixtures';
import { branding } from '../../test/flowFixtures';
import { KEY, pressKey } from '../../test/keys';
import { memoryStorage, renderWithSilo, testDevice } from '../../test/renderFlow';
import { ServerListScreen } from './ServerListScreen';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const A = 'https://a.example.test';
const B = 'https://b.example.test';
const C = 'http://192.0.2.10:8096';

/** Answers every server's branding; `names` gives the server name per origin. */
function serveBranding(names: Record<string, string | null> = {}) {
  for (const origin of [A, B, C]) {
    server.use(
      http.get(`${origin}/api/v2/theme/branding`, () => {
        const name = names[origin];
        return name === null
          ? HttpResponse.error()
          : HttpResponse.json(branding({ server_name: name ?? `Server ${origin.slice(-4)}` }));
      }),
    );
  }
}

function serveLogout(calls: { origin: string; auth: string | null }[]) {
  for (const origin of [A, B, C]) {
    server.use(
      http.post(`${origin}/api/v2/auth/logout`, ({ request }) => {
        calls.push({ origin, auth: request.headers.get('Authorization') });
        return new HttpResponse(null, { status: 204 });
      }),
    );
  }
}

function signIn(registry: ServerRegistry, origin: string, token: string) {
  registry.session(origin).set({
    accessToken: token,
    refreshToken: `${token}-refresh`,
    expiresAt: Date.now() + 3600_000,
    user: account,
  });
}

/** A registry with A (oldest), B and C (newest, so the current server). */
function registryOf(...origins: string[]) {
  let time = 1000;
  const registry = new ServerRegistry(memoryStorage(), () => (time += 1000));
  for (const origin of origins) registry.add(origin);
  return registry;
}

function setup(registry: ServerRegistry) {
  const onChoose = vi.fn();
  const onAdd = vi.fn();
  const onRemoved = vi.fn();
  const view = renderWithSilo(
    <ServerListScreen
      registry={registry}
      device={testDevice}
      onChoose={onChoose}
      onAdd={onAdd}
      onRemoved={onRemoved}
    />,
  );
  return { ...view, onChoose, onAdd, onRemoved };
}

// A server row's name starts with the server name (its Remove button's starts with "Remove").
const row = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });

describe('ServerListScreen', () => {
  it('lists the current server first, then by last use, with the focus on the current server', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo', [C]: 'Charlie' });
    setup(registryOf(A, B, C));
    const list = await screen.findByTestId('server-list');
    const rows = Array.from(list.querySelectorAll('.server-row .server-name')).map(
      (el) => el.textContent,
    );
    // The names come from the branding once it arrived; before that they are the hosts.
    await waitFor(() =>
      expect(
        Array.from(list.querySelectorAll('.server-row .server-name')).map((el) => el.textContent),
      ).toEqual(['Charlie', 'Bravo', 'Alpha']),
    );
    expect(rows).toHaveLength(3);
    await waitFor(() => expect(row('Charlie')).toHaveFocus());
  });

  it('shows the host, and a Secure badge for https and an HTTP badge for plain http', async () => {
    serveBranding({ [A]: 'Alpha', [C]: 'Charlie' });
    setup(registryOf(A, C));
    await screen.findByTestId('server-list');
    await waitFor(() => expect(row('Charlie')).toBeInTheDocument());
    const charlie = row('Charlie');
    expect(charlie).toHaveTextContent('192.0.2.10:8096');
    expect(charlie.querySelector('[data-testid="server-security"]')).toHaveTextContent('HTTP');
    const alpha = row('Alpha');
    expect(alpha).toHaveTextContent('a.example.test');
    expect(alpha.querySelector('[data-testid="server-security"]')).toHaveTextContent('Secure');
  });

  it('shows the mark from the branding, else an initial badge', async () => {
    server.use(
      http.get(`${A}/api/v2/theme/branding`, () =>
        HttpResponse.json(branding({ server_name: 'Alpha', mark_url: '/mark.png' })),
      ),
      http.get(`${B}/api/v2/theme/branding`, () =>
        HttpResponse.json(branding({ server_name: 'Bravo' })),
      ),
    );
    setup(registryOf(A, B));
    expect(await screen.findByTestId('server-mark')).toHaveAttribute('src', `${A}/mark.png`);
    expect(screen.getByTestId('server-badge')).toHaveTextContent('B');
  });

  it('refreshes the saved name from the branding, and keeps it when the branding fails', async () => {
    serveBranding({ [A]: 'Alpha Cinema', [B]: null });
    const registry = registryOf(A, B);
    registry.rename(B, 'Bravo (saved)');
    setup(registry);
    await waitFor(() => expect(registry.get(A)?.name).toBe('Alpha Cinema'));
    // B did not answer: the saved name is not replaced by the host.
    await screen.findByTestId('server-list');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registry.get(B)?.name).toBe('Bravo (saved)');
    expect(row('Bravo (saved)')).toBeInTheDocument();
  });

  it('ends with an "Add server" row that adds a server', async () => {
    serveBranding();
    const { onAdd } = setup(registryOf(A, B));
    const add = await screen.findByRole('button', { name: 'Add server' });
    const rows = screen.getByTestId('server-list').querySelectorAll('li');
    expect(rows[rows.length - 1]).toContainElement(add);
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('OK on a server row chooses that server', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    const { onChoose } = setup(registryOf(A, B));
    await waitFor(() => expect(row('Bravo')).toHaveFocus());
    await pressKey(KEY.down);
    expect(row('Alpha')).toHaveFocus();
    await pressKey(KEY.enter);
    expect(onChoose).toHaveBeenCalledWith(A);
  });

  it('Right from a row reaches its Remove button, Left comes back', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    setup(registryOf(A, B));
    await waitFor(() => expect(row('Bravo')).toHaveFocus());
    await pressKey(KEY.right);
    expect(screen.getByRole('button', { name: 'Remove Bravo' })).toHaveFocus();
    await pressKey(KEY.left);
    expect(row('Bravo')).toHaveFocus();
  });

  it('asks before removing; Cancel and Back keep the server and give the focus back', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    const registry = registryOf(A, B);
    const { onRemoved } = setup(registry);
    await waitFor(() => expect(row('Bravo')).toHaveFocus());
    await pressKey(KEY.right);
    await pressKey(KEY.enter);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove this server?');
    expect(dialog).toHaveTextContent('Bravo is removed from this TV');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    // Cancel keeps it.
    await pressKey(KEY.enter);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(registry.get(B)).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Bravo' })).toHaveFocus());
    // Back closes it too, and does not leave the list.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bravo' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { keyCode: KEY.back });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('exit-dialog')).not.toBeInTheDocument();
    expect(registry.get(B)).not.toBeNull();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('confirming signs out of that server, deletes its session and its entry, and keeps the others', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    const calls: { origin: string; auth: string | null }[] = [];
    serveLogout(calls);
    const registry = registryOf(A, B);
    signIn(registry, A, 'token-a');
    signIn(registry, B, 'token-b');
    const { onRemoved } = setup(registry);
    await screen.findByRole('button', { name: 'Remove Bravo' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bravo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(B));
    // The logout went to B only, with B's token.
    expect(calls).toEqual([{ origin: B, auth: 'Bearer token-b' }]);
    expect(registry.get(B)).toBeNull();
    expect(registry.hasSession(B)).toBe(false);
    expect(registry.hasSession(A)).toBe(true);
    expect(screen.queryByRole('button', { name: /^Bravo/ })).not.toBeInTheDocument();
    expect(row('Alpha')).toBeInTheDocument();
  });

  it('purges the cached queries of the removed server and keeps those of the others', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    const registry = registryOf(A, B);
    const { onRemoved, queryClient } = setup(registry);
    // Seeded queries must outlive the test client's zero cache time until the removal ran.
    queryClient.setDefaultOptions({ queries: { gcTime: Infinity } });
    queryClient.setQueryData(['profiles', A, 'user-1'], [1]);
    queryClient.setQueryData(['libraries', A, 'p1'], [2]);
    queryClient.setQueryData(['profiles', B, 'user-1'], [3]);
    const keysOf = (origin: string) =>
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey)
        .filter((key) => key.includes(origin));
    expect(keysOf(A).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(A));
    expect(keysOf(A)).toEqual([]);
    expect(keysOf(B)).toContainEqual(['profiles', B, 'user-1']);
  });

  it('removes a server that has no session without calling logout', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    const calls: { origin: string; auth: string | null }[] = [];
    serveLogout(calls);
    const registry = registryOf(A, B);
    const { onRemoved } = setup(registry);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(A));
    expect(calls).toEqual([]);
    expect(registry.get(A)).toBeNull();
  });

  it('removes the server even when it cannot be reached to sign out', async () => {
    serveBranding({ [A]: 'Alpha', [B]: 'Bravo' });
    server.use(http.post(`${B}/api/v2/auth/logout`, () => HttpResponse.error()));
    const registry = registryOf(A, B);
    signIn(registry, B, 'token-b');
    const { onRemoved } = setup(registry);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Bravo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(B));
    expect(registry.get(B)).toBeNull();
    expect(registry.hasSession(B)).toBe(false);
  });

  it('Back on the list (the entry page) opens the exit popup', async () => {
    serveBranding();
    setup(registryOf(A));
    await screen.findByTestId('server-list');
    fireEvent.keyDown(window, { keyCode: KEY.back });
    expect(await screen.findByTestId('exit-dialog')).toBeInTheDocument();
  });
});
