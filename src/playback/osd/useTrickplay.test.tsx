// The trickplay read: when it goes out, what it carries, and that it is repeated after the signed
// sheet URLs expire. Fake timers from the start; the loop below lets MSW's answers through.
import { useEffect } from 'react';
import { act, cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../api/session';
import { account, BASE_URL } from '../../test/apiFixtures';
import { serveTrickplay, trickplayManifest } from '../../test/playbackFixtures';
import { memoryStorage, renderWithSilo } from '../../test/renderFlow';
import { useTrickplay } from './useTrickplay';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  seen.current = undefined;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  server.resetHandlers();
});

const seen: { current: ReturnType<typeof useTrickplay> } = { current: undefined };
function Probe({ enabled }: { enabled: boolean }) {
  const value = useTrickplay('m1', 'file-9', enabled);
  useEffect(() => {
    seen.current = value;
  });
  return null;
}

function mount(enabled: boolean) {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    profileId: 'p1',
  });
  return renderWithSilo(<Probe enabled={enabled} />, { session });
}

/** Lets pending requests and React Query's notifications run, without moving the clock far. */
async function settle(ms = 100) {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms / 10);
    });
  }
}

describe('useTrickplay', () => {
  it('sends no request while the gates are not both true', async () => {
    const calls = serveTrickplay(server);
    mount(false);
    await settle();
    expect(calls).toHaveLength(0);
    expect(seen.current).toBeUndefined();
  });

  it('reads the playing file with the profile header and resolves the sheet URLs', async () => {
    const calls = serveTrickplay(server);
    mount(true);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/api/v2/watch/m1/trickplay');
    expect(calls[0]!.url.searchParams.get('file_id')).toBe('file-9');
    expect(calls[0]!.headers.get('X-Profile-Id')).toBe('p1');
    expect(seen.current?.sheetUrls[1]).toBe(
      `${BASE_URL}/api/v2/artwork/trickplay/file-1/rev1/1.rev1.jpg?exp=1893456000&sig=sig1`,
    );
  });

  it('does not hammer the server for a manifest that expires years from now', async () => {
    // A timer for a far date overflows and fires at once; the default manifest expires in 2030.
    const calls = serveTrickplay(server);
    mount(true);
    await settle(10_000);
    expect(calls).toHaveLength(1);
  });

  it('reads again once the sheet URLs have expired, and not before', async () => {
    const calls = serveTrickplay(server, () =>
      trickplayManifest({ expires_at: new Date(Date.now() + 60_000).toISOString() }),
    );
    mount(true);
    await settle();
    expect(calls).toHaveLength(1);
    await settle(59_000);
    expect(calls).toHaveLength(1);
    await settle(2_000);
    expect(calls).toHaveLength(2);
  });

  it('leaves no manifest after a failed read, without retrying at once', async () => {
    const calls = serveTrickplay(server, 500);
    mount(true);
    await settle(2_000);
    expect(seen.current).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
