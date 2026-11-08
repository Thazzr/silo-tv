import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeviceIdentity, type DeviceIdentity } from '../api/deviceIdentity';
import { Session } from '../api/session';
import { SignInScreen } from '../features/auth/SignInScreen';
import { LibraryScreen } from '../features/library/LibraryScreen';
import { ProfilesScreen } from '../features/profiles/ProfilesScreen';
import { ServerScreen } from '../features/server/ServerScreen';
import type { Launch } from './launch';
import { loadServer, saveServer } from './serverStore';
import { SiloProvider } from './SiloContext';

type Step = 'server' | 'signIn' | 'profiles' | 'library';

export interface FlowAppProps {
  launch: Launch;
  /** Injected by tests; the app creates its own. */
  session?: Session;
  device?: DeviceIdentity;
  storage?: Storage | null;
}

function startStep(launch: Launch, server: string | null, session: Session): Step {
  // A server given at launch is always shown (and checked) first.
  if (launch.server || !server) return 'server';
  const current = session.get();
  if (!current) return 'signIn';
  return current.profileId ? 'library' : 'profiles';
}

/**
 * The first real flow: server → signIn → profiles → library. A small state machine instead of a
 * router; Phase 1 replaces it with real navigation.
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
  const [step, setStep] = useState<Step>(() => startStep(launch, server, session));
  // After Back from the library the profile list must show even with a single profile.
  const [autoSelect, setAutoSelect] = useState(true);

  // A refused refresh or a sign-out ends the session wherever the user is.
  useEffect(
    () =>
      session.on('signedOut', () => {
        queryClient.removeQueries();
        setStep('signIn');
      }),
    [session, queryClient],
  );

  const connected = useCallback(
    (origin: string) => {
      // Tokens belong to one server: connecting to another one drops them.
      if (origin !== server) session.signOut();
      saveServer(origin, storage);
      setServer(origin);
      const current = session.get();
      setAutoSelect(true);
      setStep(!current ? 'signIn' : current.profileId ? 'library' : 'profiles');
    },
    [server, session, storage],
  );

  const toLibrary = useCallback(() => setStep('library'), []);

  if (step === 'server' || !server) {
    return (
      <ServerScreen
        initial={launch.server || server || ''}
        device={device}
        onConnected={connected}
      />
    );
  }

  return (
    <SiloProvider baseUrl={server} session={session} device={device}>
      {step === 'signIn' ? (
        <SignInScreen
          onSignedIn={() => {
            setAutoSelect(true);
            setStep('profiles');
          }}
          onBack={() => setStep('server')}
        />
      ) : null}
      {step === 'profiles' ? (
        <ProfilesScreen autoSelect={autoSelect} onSelected={toLibrary} />
      ) : null}
      {step === 'library' ? (
        <LibraryScreen
          onBack={() => {
            session.update({ profileId: undefined, profileToken: undefined });
            queryClient.removeQueries({ queryKey: ['libraries'] });
            queryClient.removeQueries({ queryKey: ['catalog'] });
            setAutoSelect(false);
            setStep('profiles');
          }}
        />
      ) : null}
    </SiloProvider>
  );
}
