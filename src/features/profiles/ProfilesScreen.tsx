import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSilo } from '../../app/SiloContext';
import { ErrorState, ListSkeleton, Screen, Button } from '../../app/ui';
import { useT } from '../../i18n';
import { useBranding } from '../branding/queries';
import { CreateProfile } from './CreateProfile';
import { PinEntry } from './PinEntry';
import { AddProfileTile, ProfileTile } from './ProfileTile';
import { SignOutDialog } from './SignOutDialog';
import { useSignOut } from '../library/queries';
import { primaryProfile, useProfiles, type Profile } from './queries';

/** Focus target of the "Add profile" tile; a profile id never looks like this. */
const ADD_TARGET = '\u0000add';

type View =
  | { kind: 'list' }
  /** PIN of a profile to open, or of the primary profile to create one as it. */
  | { kind: 'pin'; profile: Profile; purpose: 'open' | 'create' }
  | { kind: 'create'; token: string | undefined };

export function ProfilesScreen({
  autoSelect,
  initialFocusId = null,
  resumeId = null,
  onSelected,
}: {
  /** Skip the list when there is exactly one profile without a PIN. Off after Back from the library. */
  autoSelect: boolean;
  /** The profile last chosen on this device; the picker starts on it. */
  initialFocusId?: string | null;
  /**
   * The profile the device setting wants to reopen. It opens only after the list shows that it
   * still exists and has no PIN; otherwise (or while the list cannot be read) the picker shows.
   */
  resumeId?: string | null;
  /** `viaPicker` is false when the only profile was opened without a question. */
  onSelected: (profile: Profile, viaPicker: boolean) => void;
}) {
  const t = useT();
  const { session } = useSilo();
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [focusTarget, setFocusTarget] = useState<string | null>(initialFocusId);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const branding = useBranding();
  const autoDone = useRef(false);
  const resumeDone = useRef(false);

  const choose = (profile: Profile, profileToken?: string) => {
    session.update({ profileId: profile.id, profileToken });
    onSelected(profile, true);
  };

  const items = profiles.data;
  const only = items && items.length === 1 ? items[0] : undefined;
  useEffect(() => {
    if (!autoSelect || autoDone.current || !only || only.has_pin) return;
    autoDone.current = true;
    session.update({ profileId: only.id, profileToken: undefined });
    onSelected(only, false);
  }, [autoSelect, only, session, onSelected]);

  const resumeTarget = resumeId ? items?.find((p) => p.id === resumeId) : undefined;
  const resuming = resumeTarget !== undefined && !resumeTarget.has_pin;
  useEffect(() => {
    if (!resuming || resumeDone.current || autoDone.current || !resumeTarget) return;
    resumeDone.current = true;
    session.update({ profileId: resumeTarget.id, profileToken: undefined });
    onSelected(resumeTarget, false);
  }, [resuming, resumeTarget, session, onSelected]);

  const toList = (target: string | null) => {
    setFocusTarget(target);
    setView({ kind: 'list' });
  };
  // Back in PIN entry or the form returns to the list; on the list it is the default (the exit
  // popup, as this is the root).
  const back = signOutOpen
    ? () => setSignOutOpen(false)
    : view.kind === 'list'
      ? undefined
      : () => toList(focusTarget);
  const signOut = useSignOut();

  const primary = primaryProfile(items);
  const startTarget =
    focusTarget === ADD_TARGET && primary
      ? ADD_TARGET
      : (items?.find((p) => p.id === focusTarget)?.id ?? items?.[0]?.id);

  // The focused tile shows its scale and ring through a class; it is cleared when the focus leaves.
  const focusProps = (key: string) => ({
    focused: focusedKey === key,
    onFocused: () => setFocusedKey(key),
    onBlurred: () => setFocusedKey((current) => (current === key ? null : current)),
  });

  const openAdd = () => {
    if (!primary) return;
    setFocusTarget(ADD_TARGET);
    // A PIN-locked primary profile is asked for its PIN first; that chooses no profile.
    setView(
      primary.has_pin
        ? { kind: 'pin', profile: primary, purpose: 'create' }
        : { kind: 'create', token: undefined },
    );
  };

  const created = (profile: Profile) => {
    // The new profile joins the list at once; the refetch then confirms what the server holds.
    queryClient.setQueriesData<Profile[]>({ queryKey: ['profiles'] }, (current) =>
      current && !current.some((p) => p.id === profile.id) ? [...current, profile] : current,
    );
    void queryClient.invalidateQueries({ queryKey: ['profiles'] });
    toList(profile.id);
  };

  let body;
  if (profiles.isPending) {
    body = <ListSkeleton label={t('profiles.loading')} rows={3} />;
  } else if (profiles.isError) {
    body = <ErrorState message={t('profiles.error')} onRetry={() => void profiles.refetch()} />;
  } else if (resuming && view.kind === 'list') {
    // The effect above opens it; show the cue until the screen changes.
    body = <ListSkeleton label={t('profiles.loading')} rows={1} />;
  } else if (view.kind === 'pin') {
    const { profile, purpose } = view;
    body = (
      <PinEntry
        profile={profile}
        onVerified={(token) =>
          purpose === 'open' ? choose(profile, token) : setView({ kind: 'create', token })
        }
      />
    );
  } else if (view.kind === 'create') {
    body = (
      <CreateProfile
        primaryToken={view.token}
        onCreated={created}
        onCancel={() => toList(ADD_TARGET)}
        // The server refused the primary profile's proof: its PIN is asked for again.
        onTokenRefused={() =>
          primary && setView({ kind: 'pin', profile: primary, purpose: 'create' })
        }
      />
    );
  } else if (items?.length === 0) {
    body = <p className="note">{t('profiles.none')}</p>;
  } else if (autoSelect && only && !only.has_pin) {
    // The effect above selects it; show the cue until the screen changes.
    body = <ListSkeleton label={t('profiles.loading')} rows={1} />;
  } else {
    body = (
      <ul
        className="profile-grid"
        data-testid="profile-list"
        data-columns={(items?.length ?? 0) + (primary ? 1 : 0)}
      >
        {items?.map((profile) => (
          <li key={profile.id}>
            <ProfileTile
              profile={profile}
              focusKey={`profile-${profile.id}`}
              autoFocus={startTarget === profile.id}
              {...focusProps(`profile-${profile.id}`)}
              onClick={() => {
                setFocusTarget(profile.id);
                if (profile.has_pin) setView({ kind: 'pin', profile, purpose: 'open' });
                else choose(profile);
              }}
            />
          </li>
        ))}
        {primary ? (
          <li>
            <AddProfileTile
              focusKey="profile-add"
              autoFocus={startTarget === ADD_TARGET}
              {...focusProps('profile-add')}
              onClick={openAdd}
            />
          </li>
        ) : null}
      </ul>
    );
  }

  const title =
    view.kind === 'pin'
      ? t('pin.title')
      : view.kind === 'create'
        ? t('profiles.create.title')
        : t('profiles.title');

  return (
    <Screen
      title={title}
      onBack={back}
      testId="profiles-screen"
      className={view.kind === 'list' ? 'picker' : undefined}
    >
      {body}
      {view.kind === 'list' ? (
        <Button
          focusKey="signout"
          className="secondary"
          disabled={signOut.isPending}
          onClick={() => setSignOutOpen(true)}
        >
          {t('library.signOut')}
        </Button>
      ) : null}
      {signOutOpen ? (
        <SignOutDialog
          server={branding.serverName}
          busy={signOut.isPending}
          onCancel={() => setSignOutOpen(false)}
          onConfirm={() => signOut.mutate()}
        />
      ) : null}
    </Screen>
  );
}
