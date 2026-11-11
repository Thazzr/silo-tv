import { render } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SiloProvider } from '../app/SiloContext';
import { Session } from '../api/session';
import { BASE_URL, account } from '../test/apiFixtures';
import { memoryStorage, testDevice } from '../test/renderFlow';
import { useTrackPrefs, type TrackPrefWriter } from './trackPrefs';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function sessionOf(profileId?: string): Session {
  const session = new Session(memoryStorage());
  session.set({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3600_000,
    user: account,
    ...(profileId ? { profileId } : {}),
  });
  return session;
}

function serveAudio() {
  const profiles: (string | null)[] = [];
  server.use(
    http.put(`${BASE_URL}/api/v2/audio-prefs/:id`, ({ request }) => {
      profiles.push(request.headers.get('X-Profile-Id'));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return profiles;
}

/** Renders the hook inside a provider for `session`, and hands back the writer of the latest render. */
function mountHook(session: Session) {
  const seen: { writer: TrackPrefWriter | null } = { writer: null };
  function Probe() {
    seen.writer = useTrackPrefs();
    return null;
  }
  const tree = (current: Session) => (
    <SiloProvider baseUrl={BASE_URL} session={current} device={testDevice}>
      <Probe />
    </SiloProvider>
  );
  const view = render(tree(session));
  return { seen, again: (next: Session) => view.rerender(tree(next)) };
}

describe('useTrackPrefs', () => {
  it('saves for the profile of the session', async () => {
    const profiles = serveAudio();
    const { seen } = mountHook(sessionOf('p1'));
    await seen.writer!.audio('s1', 0, { default: false });
    expect(profiles).toEqual(['p1']);
  });

  it('saves nothing when the session has no profile, or none is signed in', async () => {
    const profiles = serveAudio();
    const noProfile = mountHook(sessionOf());
    await noProfile.seen.writer!.audio('s1', 0, { default: false });
    const signedOut = mountHook(new Session(memoryStorage()));
    await signedOut.seen.writer!.audio('s1', 0, { default: false });
    expect(profiles).toEqual([]);
  });

  it('follows a new session: the writer is made again for it', async () => {
    const profiles = serveAudio();
    const { seen, again } = mountHook(sessionOf('p1'));
    again(sessionOf());
    await seen.writer!.audio('s1', 0, { default: false });
    expect(profiles).toEqual([]);
    again(sessionOf('p2'));
    await seen.writer!.audio('s1', 0, { default: false });
    expect(profiles).toEqual(['p2']);
  });

  it('keeps the same writer while nothing changes, so its order of saves holds', () => {
    const session = sessionOf('p1');
    const { seen, again } = mountHook(session);
    const first = seen.writer;
    again(session);
    expect(seen.writer).toBe(first);
  });
});
