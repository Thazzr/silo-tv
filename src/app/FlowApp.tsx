import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeviceIdentity, type DeviceIdentity } from '../api/deviceIdentity';
import type { Session } from '../api/session';
import type { KeyValueStore } from '../platform';
import { PasswordScreen } from '../features/auth/PasswordScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { AccentTheme, BrandBackdrop, BrandHeader } from '../features/branding/components';
import { ProfilesScreen } from '../features/profiles/ProfilesScreen';
import { ServerScreen } from '../features/server/ServerScreen';
import { ServerListScreen } from '../features/servers/ServerListScreen';
import { PlayerScreen } from '../playback/PlayerScreen';
import type { Launch } from './launch';
import { Navigator, useNavigator, type NavApi } from './nav';
import { ServerRegistry } from './servers';
import { ShellMemory, ShellScreen } from './shell';
import { SiloProvider } from './SiloContext';

/** One entry of the screen stack. */
type FlowScreen =
  /** Type the address of a server to add. */
  | { name: 'add' }
  /** The saved servers. */
  | { name: 'servers' }
  | { name: 'signIn' }
  | { name: 'password' }
  /** `autoSelect` is off after "Switch profile", so a single profile is still shown. */
  | { name: 'profiles'; autoSelect: boolean }
  | { name: 'shell' }
  | { name: 'player'; contentId: string; title: string };

export interface FlowAppProps {
  launch: Launch;
  /** Injected by tests; the app creates its own on `storage`. */
  registry?: ServerRegistry;
  device?: DeviceIdentity;
  storage?: KeyValueStore | null;
}

/** Where the app opens: the screen that follows from the saved servers and their sessions. */
function startScreen(launch: Launch, registry: ServerRegistry): FlowScreen {
  const servers = registry.list();
  // A server given at launch is always shown (and checked) first.
  if (launch.server || servers.length === 0) return { name: 'add' };
  // Several servers always start at the list; a single one needs no list step.
  if (servers.length > 1) return { name: 'servers' };
  const current = registry.session(servers[0]!.origin).get();
  if (!current) return { name: 'signIn' };
  return current.profileId ? { name: 'shell' } : { name: 'profiles', autoSelect: true };
}

/** A refused refresh or a sign-out ends the session wherever the user is. */
function SignedOutWatcher({ session }: { session: Session | null }) {
  const queryClient = useQueryClient();
  const nav = useNavigator<FlowScreen>();
  const { reset } = nav;
  useEffect(
    () =>
      session?.on('signedOut', () => {
        queryClient.removeQueries();
        reset({ name: 'signIn' });
      }),
    [session, queryClient, reset],
  );
  return null;
}

/**
 * The app flow as a screen stack: add server or the server list → signIn (→ password) → profiles
 * → shell → player. Every saved server has its own session, so the sign-in screens, the profiles
 * and the shell always belong to the active server: the one used last.
 */
export function FlowApp({
  launch,
  registry: injected,
  device: injectedDevice,
  storage,
}: FlowAppProps) {
  const queryClient = useQueryClient();
  const [registry] = useState(() => injected ?? new ServerRegistry(storage));
  const [device] = useState(() => injectedDevice ?? getDeviceIdentity());
  const [origin, setOrigin] = useState<string | null>(() => registry.current()?.origin ?? null);
  const [initial] = useState(() => startScreen(launch, registry));
  const [shellMemory] = useState(() => new ShellMemory());
  const session = origin ? registry.session(origin) : null;

  /** Opens the shell as the root of a fresh visit: Home selected, no focus remembered. */
  const openShell = useCallback(
    (nav: NavApi<FlowScreen>) => {
      shellMemory.reset();
      nav.reset({ name: 'shell' });
    },
    [shellMemory],
  );

  /** Makes a server the active one and goes on at the step its session allows. */
  const enter = useCallback(
    (nav: NavApi<FlowScreen>, target: string) => {
      setOrigin(target);
      const current = registry.session(target).get();
      if (!current) nav.push({ name: 'signIn' });
      else if (current.profileId) openShell(nav);
      else nav.reset({ name: 'profiles', autoSelect: true });
    },
    [registry, openShell],
  );

  const renderScreen = (screen: FlowScreen, nav: NavApi<FlowScreen>) => {
    // The server's branding is shown for the active server; without one there is nothing to ask.
    const provide = (content: ReactNode, branded?: 'signIn') =>
      origin && session ? (
        <SiloProvider baseUrl={origin} session={session} device={device}>
          <AccentTheme />
          {branded ? <BrandBackdrop /> : null}
          {branded ? <BrandHeader withSubtitle /> : null}
          {content}
        </SiloProvider>
      ) : (
        content
      );

    switch (screen.name) {
      case 'servers':
        return (
          <ServerListScreen
            registry={registry}
            device={device}
            onChoose={(target) => {
              registry.touch(target);
              enter(nav, target);
            }}
            onAdd={() => nav.push({ name: 'add' })}
            onRemoved={(removed) => {
              const next = registry.current();
              if (!next) {
                setOrigin(null);
                nav.reset({ name: 'add' });
              } else if (removed === origin) {
                // The active server is gone and so are the screens below the list that belonged
                // to it; the most recently used server takes over.
                setOrigin(next.origin);
                nav.reset({ name: 'servers' });
              }
            }}
          />
        );
      case 'add':
        return (
          <ServerScreen
            initial={nav.depth === 1 ? launch.server : ''}
            device={device}
            onConnected={(connected) => {
              registry.add(connected);
              enter(nav, connected);
            }}
          />
        );
    }
    if (!origin || !session) return null;
    switch (screen.name) {
      case 'signIn':
        return provide(
          <SignInScreen
            onSignedIn={() => nav.reset({ name: 'profiles', autoSelect: true })}
            onPassword={() => nav.push({ name: 'password' })}
            // The sign-in screen is the root after a sign-out; Back then leads to the servers.
            onBack={() => (nav.depth > 1 ? nav.pop() : nav.replace({ name: 'servers' }))}
          />,
          'signIn',
        );
      case 'password':
        return provide(
          <PasswordScreen
            onSignedIn={() => nav.reset({ name: 'profiles', autoSelect: true })}
            onBack={nav.pop}
          />,
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
            // Every server keeps its own session; the list only changes which one is shown.
            onSwitchServer={() => nav.push({ name: 'servers' })}
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
