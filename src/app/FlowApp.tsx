import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeviceIdentity, type DeviceIdentity } from '../api/deviceIdentity';
import { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { SignInScreen } from '../features/auth/SignInScreen';
import { LibraryScreen } from '../features/library/LibraryScreen';
import { ProfilesScreen } from '../features/profiles/ProfilesScreen';
import { ServerScreen } from '../features/server/ServerScreen';
import { PlayerScreen } from '../playback/PlayerScreen';
import type { Launch } from './launch';
import { Navigator, useNavigator, type NavApi } from './nav';
import { loadServer, saveServer } from './serverStore';
import { SiloProvider } from './SiloContext';

/** One entry of the screen stack. */
type FlowScreen =
  | { name: 'server' }
  | { name: 'signIn' }
  /** `autoSelect` is off after Back from the library, so a single profile is still shown. */
  | { name: 'profiles'; autoSelect: boolean }
  | { name: 'library' }
  | { name: 'player'; contentId: string; title: string };

export interface FlowAppProps {
  launch: Launch;
  /** Injected by tests; the app creates its own. */
  session?: Session;
  device?: DeviceIdentity;
  storage?: KeyValueStore | null;
}

function startScreen(launch: Launch, server: string | null, session: Session): FlowScreen {
  // A server given at launch is always shown (and checked) first.
  if (launch.server || !server) return { name: 'server' };
  const current = session.get();
  if (!current) return { name: 'signIn' };
  return current.profileId ? { name: 'library' } : { name: 'profiles', autoSelect: true };
}

/** A refused refresh or a sign-out ends the session wherever the user is. */
function SignedOutWatcher({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const nav = useNavigator<FlowScreen>();
  const { reset } = nav;
  useEffect(
    () =>
      session.on('signedOut', () => {
        queryClient.removeQueries();
        reset({ name: 'signIn' });
      }),
    [session, queryClient, reset],
  );
  return null;
}

/**
 * The first real flow as a screen stack: server → signIn → profiles → library → player. The
 * server screen is the root while no server is known; later flows start at the screen that fits
 * the stored server and session, so Back on that screen asks to exit.
 */
export function FlowApp({
  launch,
  session: injected,
  device: injectedDevice,
  storage,
}: FlowAppProps) {
  const queryClient = useQueryClient();
  const [session] = useState(() => injected ?? new Session());
  const [device] = useState(() => injectedDevice ?? getDeviceIdentity());
  const [server, setServer] = useState(() => loadServer(storage));
  const [initial] = useState(() => startScreen(launch, server, session));

  const connected = useCallback(
    (nav: NavApi<FlowScreen>, origin: string) => {
      saveServer(origin, storage);
      setServer(origin);
      // Tokens belong to one server: connecting to another one drops them. The sign-out also
      // sends the stack to the sign-in screen (see SignedOutWatcher), so nothing is pushed then.
      if (origin !== server && session.get()) {
        session.signOut();
        return;
      }
      const current = session.get();
      if (!current) nav.push({ name: 'signIn' });
      else if (current.profileId) nav.reset({ name: 'library' });
      else nav.reset({ name: 'profiles', autoSelect: true });
    },
    [server, session, storage],
  );

  const renderScreen = (screen: FlowScreen, nav: NavApi<FlowScreen>) => {
    if (screen.name === 'server' || !server) {
      return (
        <ServerScreen
          initial={launch.server || server || ''}
          device={device}
          onConnected={(origin) => connected(nav, origin)}
        />
      );
    }
    let body;
    switch (screen.name) {
      case 'signIn':
        body = (
          <SignInScreen
            onSignedIn={() => nav.reset({ name: 'profiles', autoSelect: true })}
            // The sign-in screen is the root after a sign-out; Back then leads to the server.
            onBack={() => (nav.depth > 1 ? nav.pop() : nav.replace({ name: 'server' }))}
          />
        );
        break;
      case 'profiles':
        body = (
          <ProfilesScreen
            autoSelect={screen.autoSelect}
            onSelected={() => nav.reset({ name: 'library' })}
          />
        );
        break;
      case 'library':
        body = (
          <LibraryScreen
            onPlay={(item) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title })
            }
            onBack={() => {
              session.update({ profileId: undefined, profileToken: undefined });
              queryClient.removeQueries({ queryKey: ['libraries'] });
              queryClient.removeQueries({ queryKey: ['catalog'] });
              nav.reset({ name: 'profiles', autoSelect: false });
            }}
          />
        );
        break;
      case 'player':
        body = <PlayerScreen contentId={screen.contentId} title={screen.title} onExit={nav.pop} />;
        break;
    }
    return (
      <SiloProvider baseUrl={server} session={session} device={device}>
        {body}
      </SiloProvider>
    );
  };

  return (
    <Navigator initial={initial} renderScreen={renderScreen}>
      <SignedOutWatcher session={session} />
    </Navigator>
  );
}
