import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeviceIdentity, type DeviceIdentity } from '../api/deviceIdentity';
import type { Session } from '../api/session';
import { getPlatform, type KeyValueStore } from '../platform';
import { PasswordScreen } from '../features/auth/PasswordScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { ProfileSettingsSync } from '../features/settings/profileSettings';
import { AccentTheme, BrandBackdrop, BrandHeader } from '../features/branding/components';
import { BoxSetMemory, type BoxSetTarget } from '../features/boxset/boxSetMemory';
import { BoxSetScreen } from '../features/boxset/BoxSetScreen';
import { DetailMemory, type DetailTarget } from '../features/detail/detailMemory';
import { DetailScreen } from '../features/detail/DetailScreen';
import { PersonMemory, type PersonTarget } from '../features/person/personMemory';
import { PersonScreen } from '../features/person/PersonScreen';
import { ProfileLaunchPrefs } from '../features/profiles/launchPrefs';
import { ProfilesScreen } from '../features/profiles/ProfilesScreen';
import { ServerScreen } from '../features/server/ServerScreen';
import { ServerListScreen } from '../features/servers/ServerListScreen';
import { SectionGridScreen } from '../features/home/SectionGridScreen';
import { CollectionScreen } from '../features/library/CollectionScreen';
import type { CollectionTarget } from '../features/library/targets';
import { PlayerScreen } from '../playback/PlayerScreen';
import type { StartIntent } from '../playback/resume';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { FocusIndexMemory } from '../ui/media';
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
  | { name: 'profiles'; autoSelect: boolean; resumeId?: string }
  | { name: 'shell' }
  /** The full list of a Home row, or of a row of a library's Recommended view ("Explore all"). */
  | {
      name: 'sectionGrid';
      sectionId: string;
      title: string;
      library?: { id: string; type?: string };
    }
  /** One collection of a library, read-only. */
  | ({ name: 'collection' } & CollectionTarget)
  /** A movie or series; the season and episode are set when an episode card opened it. */
  | ({ name: 'detail' } & DetailTarget)
  /** A person (a cast member): portrait, biography and filmography. */
  | ({ name: 'person' } & PersonTarget)
  /** A box set of movies: the hero with Play, and its films. */
  | ({ name: 'boxSet' } & BoxSetTarget)
  /** The intent says how it starts; without one the player asks when there is something to resume. */
  | { name: 'player'; contentId: string; title: string; intent?: StartIntent }
  /** The device settings. */
  | { name: 'settings' };

export interface FlowAppProps {
  launch: Launch;
  /** Injected by tests; the app creates its own on `storage`. */
  registry?: ServerRegistry;
  device?: DeviceIdentity;
  storage?: KeyValueStore | null;
  /** The clock of the "Profile at launch" timing; tests fake it. */
  now?: () => number;
}

/** How often the use of a server is stamped while a profile is open (the timed launch modes). */
const STAMP_INTERVAL_MS = 5 * 60_000;

/**
 * Where a server opens, from its session and the device's "Profile at launch" setting: the shell
 * when the last profile reopens, else the picker. Showing the picker forgets the open profile and
 * its PIN proof, so a PIN profile asks for its PIN again.
 */
function entryScreen(
  registry: ServerRegistry,
  prefs: ProfileLaunchPrefs,
  origin: string,
): FlowScreen {
  const session = registry.session(origin);
  const current = session.get();
  if (!current) return { name: 'signIn' };
  // The profile counts as open only once the list confirmed it (it may be gone or have a PIN now),
  // so the session starts without one either way.
  const resume =
    current.profileId &&
    current.profileId === prefs.get(origin).lastProfileId &&
    !prefs.shouldShowPicker(origin)
      ? current.profileId
      : undefined;
  if (current.profileId) session.update({ profileId: undefined, profileToken: undefined });
  return { name: 'profiles', autoSelect: true, resumeId: resume };
}

/** Where the app opens: the screen that follows from the saved servers and their sessions. */
function startScreen(
  launch: Launch,
  registry: ServerRegistry,
  prefs: ProfileLaunchPrefs,
): FlowScreen {
  const servers = registry.list();
  // A server given at launch is always shown (and checked) first.
  if (launch.server || servers.length === 0) return { name: 'add' };
  // Several servers always start at the list; a single one needs no list step.
  if (servers.length > 1) return { name: 'servers' };
  return entryScreen(registry, prefs, servers[0]!.origin);
}

/** A refused refresh or a sign-out ends the session wherever the user is. */
function SignedOutWatcher({ session, onEnd }: { session: Session | null; onEnd: () => void }) {
  const queryClient = useQueryClient();
  const nav = useNavigator<FlowScreen>();
  const { reset } = nav;
  useEffect(
    () =>
      session?.on('signedOut', () => {
        queryClient.removeQueries();
        onEnd();
        reset({ name: 'signIn' });
      }),
    [session, queryClient, reset, onEnd],
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
  now,
}: FlowAppProps) {
  const queryClient = useQueryClient();
  const [registry] = useState(() => injected ?? new ServerRegistry(storage));
  const [device] = useState(() => injectedDevice ?? getDeviceIdentity());
  const [origin, setOrigin] = useState<string | null>(() => registry.current()?.origin ?? null);
  const [prefs] = useState(
    () => new ProfileLaunchPrefs(storage === undefined ? getPlatform().storage : storage, now),
  );
  const [initial] = useState(() => startScreen(launch, registry, prefs));
  /** "Open {name} automatically?", asked once after the first pick on this server. */
  const [offer, setOffer] = useState<{ origin: string; name: string } | null>(null);
  const clearOffer = useCallback(() => setOffer(null), []);
  const [shellMemory] = useState(() => new ShellMemory());
  /** Where the focus was in each row grid; it survives the player being opened over the grid. */
  const [gridMemory] = useState(() => new FocusIndexMemory());
  /** What each open detail page remembers (season, focused cards) while the player covers it. */
  const [detailMemory] = useState(() => new DetailMemory());
  /** What each open person page remembers (filter, focused card) while a title covers it. */
  const [personMemory] = useState(() => new PersonMemory());
  /** What each open box set page remembers (the focused film) while a film covers it. */
  const [boxSetMemory] = useState(() => new BoxSetMemory());
  const session = origin ? registry.session(origin) : null;
  const launchRecord = useSyncExternalStore(prefs.subscribe, () => prefs.get(origin ?? ''));

  // Under the timed modes the last use counts: stamp it while a profile is open.
  useEffect(() => {
    if (!origin) return;
    const id = setInterval(() => {
      if (registry.session(origin).get()?.profileId) prefs.touch(origin);
    }, STAMP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [origin, registry, prefs]);

  /** Opens the shell as the root of a fresh visit: Home selected, no focus remembered. */
  const openShell = useCallback(
    (nav: NavApi<FlowScreen>) => {
      shellMemory.reset();
      gridMemory.clear();
      nav.reset({ name: 'shell' });
    },
    [shellMemory, gridMemory],
  );

  /** Makes a server the active one and goes on at the step its session allows. */
  const enter = useCallback(
    (nav: NavApi<FlowScreen>, target: string) => {
      setOrigin(target);
      const screen = entryScreen(registry, prefs, target);
      if (screen.name === 'signIn') nav.push(screen);
      else if (screen.name === 'shell') openShell(nav);
      else nav.reset(screen);
    },
    [registry, prefs, openShell],
  );

  const renderScreen = (screen: FlowScreen, nav: NavApi<FlowScreen>) => {
    const openDetail = (target: DetailTarget) => nav.push({ name: 'detail', ...target });
    // The server's branding is shown for the active server; without one there is nothing to ask.
    const provide = (content: ReactNode, branded?: 'signIn') =>
      origin && session ? (
        <SiloProvider baseUrl={origin} session={session} device={device}>
          <AccentTheme />
          <ProfileSettingsSync />
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
              prefs.clear(removed);
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
          <ProfilesScreen
            autoSelect={screen.autoSelect}
            resumeId={screen.resumeId}
            initialFocusId={launchRecord.lastProfileId}
            onSelected={(picked, viaPicker) => {
              const before = prefs.get(origin);
              prefs.recordPick(origin, picked);
              // Asked once, after the first profile the viewer picks; a PIN profile never opens by
              // itself, so there is nothing to offer for it.
              if (viaPicker && !before.offered && before.mode === 'every' && !picked.has_pin) {
                prefs.markOffered(origin);
                setOffer({ origin, name: picked.name });
              }
              openShell(nav);
            }}
          />,
        );
      case 'shell':
        return provide(
          <ShellScreen
            memory={shellMemory}
            launchMode={launchRecord.mode}
            onLaunchMode={(mode) => {
              prefs.setMode(origin, mode);
              // Choosing in the menu answers the question too.
              setOffer(null);
            }}
            offer={
              offer && offer.origin === origin
                ? {
                    name: offer.name,
                    onAnswer: (automatic) => {
                      if (automatic) prefs.setMode(origin, 'automatic');
                      setOffer(null);
                    },
                  }
                : null
            }
            onPlay={(item, intent) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title, intent })
            }
            onOpenDetail={openDetail}
            onExploreSection={(section) =>
              nav.push({
                name: 'sectionGrid',
                sectionId: section.id,
                title: section.title,
                library: section.library,
              })
            }
            onOpenCollection={(target) => nav.push({ name: 'collection', ...target })}
            onSwitchProfile={() => {
              setOffer(null);
              session.update({ profileId: undefined, profileToken: undefined });
              queryClient.removeQueries({ queryKey: ['libraries'] });
              queryClient.removeQueries({ queryKey: ['catalog'] });
              queryClient.removeQueries({ queryKey: ['home'] });
              queryClient.removeQueries({ queryKey: ['library'] });
              queryClient.removeQueries({ queryKey: ['detail'] });
              queryClient.removeQueries({ queryKey: ['person'] });
              queryClient.removeQueries({ queryKey: ['boxset'] });
              queryClient.removeQueries({ queryKey: ['search'] });
              queryClient.removeQueries({ queryKey: ['settings'] });
              nav.reset({ name: 'profiles', autoSelect: false });
            }}
            // Every server keeps its own session; the list only changes which one is shown.
            onSwitchServer={() => nav.push({ name: 'servers' })}
            onOpenSettings={() => nav.push({ name: 'settings' })}
          />,
        );
      case 'sectionGrid':
        return provide(
          <SectionGridScreen
            sectionId={screen.sectionId}
            title={screen.title}
            library={screen.library}
            memory={gridMemory}
            onPlay={(item, intent) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title, intent })
            }
            onOpenDetail={openDetail}
            onBack={nav.pop}
          />,
        );
      case 'collection':
        return provide(
          <CollectionScreen
            target={screen}
            memory={gridMemory}
            onPlay={(item, intent) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title, intent })
            }
            onOpenDetail={openDetail}
            onBack={nav.pop}
          />,
        );
      case 'detail':
        return provide(
          <DetailScreen
            target={screen}
            memory={detailMemory.of(screen)}
            onPlay={(request) =>
              nav.push({
                name: 'player',
                contentId: request.contentId,
                title: request.title,
                intent: request.intent,
              })
            }
            onOpenDetail={openDetail}
            onOpenPerson={(target) => nav.push({ name: 'person', ...target })}
            onOpenBoxSet={(target) => nav.push({ name: 'boxSet', ...target })}
            onBack={nav.pop}
          />,
        );
      case 'person':
        return provide(
          <PersonScreen
            target={screen}
            memory={personMemory.of(screen)}
            onPlay={(item, intent) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title, intent })
            }
            onOpenDetail={openDetail}
            onBack={nav.pop}
          />,
        );
      case 'boxSet':
        return provide(
          <BoxSetScreen
            target={screen}
            memory={boxSetMemory.of(screen)}
            onPlay={(item, intent) =>
              nav.push({ name: 'player', contentId: item.content_id, title: item.title, intent })
            }
            onOpenDetail={openDetail}
            onBack={nav.pop}
          />,
        );
      case 'settings':
        return provide(<SettingsScreen onBack={nav.pop} />);
      case 'player':
        return provide(
          <PlayerScreen
            contentId={screen.contentId}
            title={screen.title}
            intent={screen.intent}
            onExit={nav.pop}
            // Back from the new episode goes where Back from this one would have gone.
            onEpisode={(episode) =>
              nav.replace({
                name: 'player',
                contentId: episode.contentId,
                title: episode.title,
                intent: { kind: 'resume' },
              })
            }
          />,
        );
    }
  };

  return (
    <Navigator initial={initial} renderScreen={renderScreen}>
      <SignedOutWatcher session={session} onEnd={clearOffer} />
    </Navigator>
  );
}
