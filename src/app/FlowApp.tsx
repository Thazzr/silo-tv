import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeviceIdentity, type DeviceIdentity } from '../api/deviceIdentity';
import { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { SignInScreen } from '../features/auth/SignInScreen';
import { AccentTheme, BrandBackdrop, BrandHeader } from '../features/branding/components';
import { ProfilesScreen } from '../features/profiles/ProfilesScreen';
import { ServerScreen } from '../features/server/ServerScreen';
import { PlayerScreen } from '../playback/PlayerScreen';
import type { Launch } from './launch';
import { Navigator, useNavigator, type NavApi } from './nav';
import { loadServer, saveServer } from './serverStore';
import { ShellMemory, ShellScreen } from './shell';
import { SiloProvider } from './SiloContext';

/** One entry of the screen stack. */
type FlowScreen =
  | { name: 'server' }
  | { name: 'signIn' }
  /** `autoSelect` is off after "Switch profile", so a single profile is still shown. */
  | { name: 'profiles'; autoSelect: boolean }
  | { name: 'shell' }
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
  return current.profileId ? { name: 'shell' } : { name: 'profiles', autoSelect: true };
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
 * The first real flow as a screen stack: server → signIn → profiles → shell → player. The
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
  const [shellMemory] = useState(() => new ShellMemory());

  /** Opens the shell as the root of a fresh visit: Home selected, no focus remembered. */
  const openShell = useCallback(
    (nav: NavApi<FlowScreen>) => {
      shellMemory.reset();
      nav.reset({ name: 'shell' });
    },
    [shellMemory],
  );

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
      else if (current.profileId) openShell(nav);
      else nav.reset({ name: 'profiles', autoSelect: true });
    },
    [server, session, storage, openShell],
  );

  const renderScreen = (screen: FlowScreen, nav: NavApi<FlowScreen>) => {
    // The server's branding is shown from the stored server; without one there is nothing to ask.
    const provide = (content: ReactNode, branded?: 'server' | 'signIn') =>
      server ? (
        <SiloProvider baseUrl={server} session={session} device={device}>
          <AccentTheme />
          {branded ? <BrandBackdrop /> : null}
          {branded ? <BrandHeader withSubtitle={branded === 'signIn'} /> : null}
          {content}
        </SiloProvider>
      ) : (
        content
      );

    if (screen.name === 'server' || !server) {
      return provide(
        <ServerScreen
          initial={launch.server || server || ''}
          device={device}
          onConnected={(origin) => connected(nav, origin)}
        />,
        'server',
      );
    }
    switch (screen.name) {
      case 'signIn':
        return provide(
          <SignInScreen
            onSignedIn={() => nav.reset({ name: 'profiles', autoSelect: true })}
            // The sign-in screen is the root after a sign-out; Back then leads to the server.
            onBack={() => (nav.depth > 1 ? nav.pop() : nav.replace({ name: 'server' }))}
          />,
          'signIn',
        );
      case 'profiles':
        return provide(
          <ProfilesScreen autoSelect={screen.autoSelect} onSelected={() => openShell(nav)} />,
        );
      case 'shell':
        return provide(
          <ShellScreen
            memory={shellMemory}
            onPlay={(item) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title })
            }
            onSwitchProfile={() => {
              session.update({ profileId: undefined, profileToken: undefined });
              queryClient.removeQueries({ queryKey: ['libraries'] });
              queryClient.removeQueries({ queryKey: ['catalog'] });
              nav.reset({ name: 'profiles', autoSelect: false });
            }}
            // The stored session stays until another server is actually connected.
            onSwitchServer={() => nav.push({ name: 'server' })}
          />,
        );
      case 'player':
        return provide(
          <PlayerScreen contentId={screen.contentId} title={screen.title} onExit={nav.pop} />,
        );
    }
  };

  return (
    <Navigator initial={initial} renderScreen={renderScreen}>
      <SignedOutWatcher session={session} />
    </Navigator>
  );
}
