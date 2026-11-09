import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../api/session';
import { getPlatform, setPlatformForTests } from '../../platform';
import { account } from '../../test/apiFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { serveSettings } from '../../test/settingsFixtures';
import {
  keysKnownAt,
  ProfileSettingsSync,
  settingValuesFrom,
  useProfileSetting,
  useProfileSettings,
} from './profileSettings';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setPlatformForTests(null);
});
afterAll(() => server.close());

function sessionOf(profileId: string | null = 'p1'): Session {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: profileId ?? undefined,
  });
  return session;
}

/** Shows what one consumer gets: the value of the title-art key and whether it is known. */
function Consumer({ name = 'consumer' }: { name?: string }) {
  const { value, known } = useProfileSetting('ui.title_art');
  return (
    <div data-testid={name}>
      {String(value)}|{known ? 'known' : 'unknown'}
    </div>
  );
}

function AllValues() {
  const { values, known } = useProfileSettings();
  return <div data-testid="all">{known ? JSON.stringify(values) : 'unknown'}</div>;
}

const shows = (name: string, text: string) =>
  waitFor(() => expect(screen.getByTestId(name)).toHaveTextContent(text));

describe('keysKnownAt', () => {
  it('lists only the keys a manifest revision knows', () => {
    expect(keysKnownAt(10)).toEqual([]);
    expect(keysKnownAt(11)).toEqual(['ui.theme_music_enabled', 'ui.theme_music_loop']);
    expect(keysKnownAt(16)).toContain('ui.title_art');
    expect(keysKnownAt(16)).not.toContain('catalog.hide_unwatched_episode_images');
    expect(keysKnownAt(17)).toHaveLength(5);
  });

  it('settingValuesFrom ignores unknown keys and values of the wrong type', () => {
    const values = settingValuesFrom([
      { key: 'ui.title_art', value: 'no' },
      { key: 'ui.theme_music_loop', value: true },
      { key: 'something.else', value: true },
    ]);
    expect(values['ui.title_art']).toBe(true);
    expect(values['ui.theme_music_loop']).toBe(true);
    expect(Object.keys(values)).not.toContain('something.else');
  });
});

describe('useProfileSetting', () => {
  it('asks once with repeated keys parameters and the TV client family, then answers', async () => {
    const calls = serveSettings(server, { values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'false|known');

    const [capabilities] = calls.capabilities;
    expect(capabilities!.headers.get('X-Silo-Client-Family')).toBe('tv');
    expect(capabilities!.headers.get('X-Profile-Id')).toBe('p1');
    expect(calls.effective).toHaveLength(1);
    const request = calls.effective[0]!;
    expect(request.headers.get('X-Silo-Client-Family')).toBe('tv');
    expect(request.headers.get('X-Silo-Device-Id')).toBeTruthy();
    expect(request.headers.get('X-Profile-Id')).toBe('p1');
    const url = new URL(request.url);
    expect(url.searchParams.getAll('keys')).toEqual([
      'ui.title_art',
      'catalog.hide_unwatched_episode_images',
      'catalog.hide_unwatched_episode_overviews',
      'ui.theme_music_enabled',
      'ui.theme_music_loop',
    ]);
    // Repeated, never comma-separated.
    expect(url.search).not.toMatch(/,|%2C/i);
    expect(url.search.match(/keys=/g)).toHaveLength(5);
  });

  it('is not known while the read is in flight, and reports the default meanwhile', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    serveSettings(server, { gate, values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    expect(screen.getByTestId('consumer')).toHaveTextContent('true|unknown');
    await act(async () => {
      open();
      await Promise.resolve();
    });
    await shows('consumer', 'false|known');
  });

  it('shares one capability read and one value read between consumers', async () => {
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <Consumer name="a" />
        <Consumer name="b" />
        <AllValues />
      </>,
      { session: sessionOf() },
    );
    await shows('a', 'true|known');
    await shows('b', 'true|known');
    await shows('all', 'ui.title_art');
    expect(calls.capabilities).toHaveLength(1);
    expect(calls.effective).toHaveLength(1);
  });

  it('does not send a key the manifest revision does not cover', async () => {
    const calls = serveSettings(server, { manifestRevision: 16 });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', 'ui.title_art');
    expect(new URL(calls.effective[0]!.url).searchParams.getAll('keys')).toEqual([
      'ui.title_art',
      'ui.theme_music_enabled',
      'ui.theme_music_loop',
    ]);
  });

  it('on a server older than every key reads no values and uses the defaults', async () => {
    const calls = serveSettings(server, { manifestRevision: 10 });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
    expect(calls.effective).toHaveLength(0);
  });

  it.each([
    ['not_configured', { state: 'not_configured' as const }],
    ['unsupported', { state: 'unsupported' as const }],
    ['not allowed', { allowed: false }],
  ])(
    'uses the defaults and reads no values when the capability is %s',
    async (_name, capabilities) => {
      const calls = serveSettings(server, { capabilities, values: { 'ui.title_art': false } });
      renderWithSilo(<Consumer />, { session: sessionOf() });
      await shows('consumer', 'true|known');
      expect(calls.effective).toHaveLength(0);
    },
  );

  it('uses the defaults when the capability read fails', async () => {
    const calls = serveSettings(server, { capabilities: 'fail' });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
    expect(calls.effective).toHaveLength(0);
  });

  it('uses the defaults when the value read fails', async () => {
    serveSettings(server, { effective: 'fail', values: { 'ui.title_art': false } });
    renderWithSilo(<Consumer />, { session: sessionOf() });
    await shows('consumer', 'true|known');
  });

  it('uses the defaults when the server refuses a key (422)', async () => {
    // The manifest claims revision 40 but does not know title art: the whole read is refused.
    serveSettings(server, {
      introducedIn: { 'ui.title_art': 99 },
      values: { 'ui.title_art': false },
    });
    renderWithSilo(<AllValues />, { session: sessionOf() });
    await shows('all', '"ui.title_art":true');
  });

  it('is known with the defaults, and asks nothing, while no profile is open', async () => {
    const calls = serveSettings(server);
    renderWithSilo(<Consumer />, { session: sessionOf(null) });
    await shows('consumer', 'true|known');
    expect(calls.capabilities).toHaveLength(0);
    expect(calls.effective).toHaveLength(0);
  });

  it('reads again for another profile', async () => {
    const calls = serveSettings(server);
    const session = sessionOf('p1');
    // The consumer sits under the component that re-renders, as a screen does after a switch.
    function SwitchProfile() {
      const [, render] = useState(0);
      return (
        <>
          <button
            onClick={() => {
              session.update({ profileId: 'p2' });
              render((n) => n + 1);
            }}
          >
            switch
          </button>
          <Consumer />
        </>
      );
    }
    renderWithSilo(<SwitchProfile />, { session });
    await shows('consumer', 'true|known');
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => expect(calls.effective).toHaveLength(2));
    expect(calls.effective[1]!.headers.get('X-Profile-Id')).toBe('p2');
    expect(calls.capabilities[1]!.headers.get('X-Profile-Id')).toBe('p2');
  });
});

describe('ProfileSettingsSync', () => {
  it('reads the values again when the page becomes visible', async () => {
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <ProfileSettingsSync />
        <Consumer />
      </>,
      { session: sessionOf() },
    );
    await shows('consumer', 'true|known');
    expect(calls.effective).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(calls.effective).toHaveLength(2));
    // Hidden is not "back in the foreground".
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(calls.effective).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('reads the values again when the app is launched again', async () => {
    let relaunch: () => void = () => {};
    setPlatformForTests({
      ...getPlatform(),
      onRelaunch: (handler) => {
        relaunch = () => handler({});
        return () => {};
      },
    });
    const calls = serveSettings(server);
    renderWithSilo(
      <>
        <ProfileSettingsSync />
        <Consumer />
      </>,
      { session: sessionOf() },
    );
    await shows('consumer', 'true|known');
    act(() => relaunch());
    await waitFor(() => expect(calls.effective).toHaveLength(2));
  });
});
