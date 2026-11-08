import { useEffect, useRef, useState } from 'react';
import { useSilo } from '../../app/SiloContext';
import { ErrorState, ListSkeleton, Screen, Button } from '../../app/ui';
import { useT } from '../../i18n';
import { PinEntry } from './PinEntry';
import { useSignOut } from '../library/queries';
import { useProfiles, type Profile } from './queries';

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

export function ProfilesScreen({
  autoSelect,
  onSelected,
}: {
  /** Skip the list when there is exactly one profile without a PIN. Off after Back from the library. */
  autoSelect: boolean;
  onSelected: () => void;
}) {
  const t = useT();
  const { session } = useSilo();
  const profiles = useProfiles();
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const autoDone = useRef(false);

  const choose = (profile: Profile, profileToken?: string) => {
    session.update({ profileId: profile.id, profileToken });
    onSelected();
  };

  const items = profiles.data;
  const only = items && items.length === 1 ? items[0] : undefined;
  useEffect(() => {
    if (!autoSelect || autoDone.current || !only || only.has_pin) return;
    autoDone.current = true;
    session.update({ profileId: only.id, profileToken: undefined });
    onSelected();
  }, [autoSelect, only, session, onSelected]);

  // Back in PIN entry returns to the list; on the list it is the default (the exit popup, as this is the root).
  const back = pinFor ? () => setPinFor(null) : undefined;
  const signOut = useSignOut();

  let body;
  if (profiles.isPending) {
    body = <ListSkeleton label={t('profiles.loading')} rows={3} />;
  } else if (profiles.isError) {
    body = <ErrorState message={t('profiles.error')} onRetry={() => void profiles.refetch()} />;
  } else if (pinFor) {
    body = <PinEntry profile={pinFor} onVerified={(token) => choose(pinFor, token)} />;
  } else if (items?.length === 0) {
    body = <p className="note">{t('profiles.none')}</p>;
  } else if (autoSelect && only && !only.has_pin) {
    // The effect above selects it; show the cue until the screen changes.
    body = <ListSkeleton label={t('profiles.loading')} rows={1} />;
  } else {
    body = (
      <ul className="list" data-testid="profile-list">
        {items?.map((profile, index) => (
          <li key={profile.id}>
            <Button
              focusKey={`profile-${profile.id}`}
              className="row profile"
              autoFocus={index === 0}
              onClick={() => (profile.has_pin ? setPinFor(profile) : choose(profile))}
            >
              <span className="avatar" aria-hidden="true">
                {initial(profile.name)}
              </span>
              <span className="grow">{profile.name}</span>
              {profile.has_pin ? <span className="lock">{t('profiles.pinLocked')}</span> : null}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Screen
      title={pinFor ? t('pin.title') : t('profiles.title')}
      onBack={back}
      testId="profiles-screen"
    >
      {body}
      {pinFor ? null : (
        <Button
          focusKey="signout"
          className="secondary"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {t('library.signOut')}
        </Button>
      )}
    </Screen>
  );
}
