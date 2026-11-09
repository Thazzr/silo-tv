import { useCallback, useEffect, useRef, useState } from 'react';
import { useBranding } from '../../features/branding/queries';
import { TitleList } from '../../features/library/TitleList';
import { useSignOut, type CatalogItem } from '../../features/library/queries';
import { useProfiles } from '../../features/profiles/queries';
import {
  FocusGroup,
  FocusTrackerContext,
  getCurrentFocusKey,
  setFocus,
  useBackHandler,
  useNavigator,
} from '../nav';
import { useSilo } from '../SiloContext';
import type { LaunchMode } from '../../features/profiles/launchPrefs';
import { AvatarMenu, type MenuView } from './AvatarMenu';
import { ComingSoon } from './ComingSoon';
import { SignOutDialog } from '../../features/profiles/SignOutDialog';
import { LaunchOfferDialog } from './LaunchOfferDialog';
import { TopBar } from './TopBar';
import {
  AVATAR_KEY,
  MENU_KEY_PREFIX,
  ShellMemory,
  TAB_SWITCH_DELAY_MS,
  tabKey,
  tabOfKey,
  type TabId,
} from './tabs';

export interface ShellScreenProps {
  memory: ShellMemory;
  /** Opens the player for a title; the screen stack keeps the shell underneath. */
  onPlay: (item: CatalogItem) => void;
  onSwitchProfile: () => void;
  onSwitchServer: () => void;
  /** The device setting "Profile at launch" of this server, and its change from the menu. */
  launchMode: LaunchMode;
  onLaunchMode: (mode: LaunchMode) => void;
  /** "Open {name} automatically?", asked once after the first pick; null when there is no question. */
  offer?: { name: string; onAnswer: (automatic: boolean) => void } | null;
  /** How long a focused tab waits before its content replaces the old one; tests stretch it. */
  switchDelayMs?: number;
}

function TabContent({
  tab,
  onPlay,
  onHome,
}: {
  tab: TabId;
  onPlay: (item: CatalogItem) => void;
  onHome: () => void;
}) {
  switch (tab) {
    case 'home':
      return <TitleList kind="video" onPlay={onPlay} />;
    case 'movies':
      return <TitleList kind="movie" onPlay={onPlay} />;
    case 'series':
      return <TitleList kind="series" onPlay={onPlay} />;
    default:
      // For You, Calendar and Search come with Phase 2.
      return <ComingSoon onHome={onHome} />;
  }
}

/**
 * The frame after a profile is chosen: a top bar with the tabs and the avatar menu, and the
 * content of the selected tab below it.
 *
 * Focus rules: Down enters the content, Up from its first row returns to the selected tab. A tab
 * that takes the focus shows its content only after a short delay, so moving across the bar does
 * not mount every tab on the way. Each tab remembers its focused element (kept in `memory`, as
 * the stack unmounts the shell while the player is open). Back closes the menu, then leaves the
 * content for the tab bar, then the bar for Home, and on Home it asks to exit.
 */
export function ShellScreen({
  memory,
  onPlay,
  onSwitchProfile,
  onSwitchServer,
  launchMode,
  onLaunchMode,
  offer = null,
  switchDelayMs = TAB_SWITCH_DELAY_MS,
}: ShellScreenProps) {
  const nav = useNavigator();
  const { session } = useSilo();
  const branding = useBranding();
  const profiles = useProfiles();
  const signOut = useSignOut();

  // The tab that has the focus first; later changes of the selection must not move it.
  const [initialTab] = useState(memory.tab);
  const [selected, setSelected] = useState<TabId>(memory.tab);
  const selectedRef = useRef<TabId>(memory.tab);
  // Which part of the avatar menu is open; null while it is closed.
  const [menu, setMenu] = useState<MenuView | null>(null);
  // "Sign out of {server}?" over the open menu.
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  // The offer comes once the shell has rendered, so its focus does not fight the screen's own.
  useEffect(() => {
    const id = setTimeout(() => setRendered(true), 0);
    return () => clearTimeout(id);
  }, []);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  }, []);
  useEffect(() => clearPending, [clearPending]);

  const select = useCallback(
    (tab: TabId) => {
      clearPending();
      selectedRef.current = tab;
      memory.selectTab(tab);
      setSelected(tab);
    },
    [clearPending, memory],
  );

  // A tab that has the focus is shown after the delay; moving on before that cancels it.
  const tabFocused = useCallback(
    (tab: TabId) => {
      clearPending();
      if (tab === selectedRef.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        select(tab);
      }, switchDelayMs);
    },
    [clearPending, select, switchDelayMs],
  );

  // Every focusable below the shell reports here; only the content matters for the memory.
  const report = useCallback(
    (focusKey: string) => {
      if (tabOfKey(focusKey) !== null || focusKey === AVATAR_KEY) return;
      if (focusKey.startsWith(MENU_KEY_PREFIX)) return;
      // Down into the content before the delay ran out: the content that is shown stays.
      clearPending();
      memory.rememberFocus(selectedRef.current, focusKey);
    },
    [clearPending, memory],
  );

  const goHome = useCallback(() => {
    select('home');
    void setFocus(tabKey('home'));
  }, [select]);

  useBackHandler(() => {
    if (offer) {
      // Back answers the question with No, like Cancel in the exit popup.
      offer.onAnswer(false);
      return;
    }
    if (signOutOpen) {
      setSignOutOpen(false);
      return;
    }
    if (menu) {
      setMenu(menu === 'launch' ? 'main' : null);
      return;
    }
    const focused = getCurrentFocusKey();
    const onBar = (focused !== null && tabOfKey(focused) !== null) || focused === AVATAR_KEY;
    if (!onBar) {
      void setFocus(tabKey(selectedRef.current));
    } else if (focused === tabKey('home') && selectedRef.current === 'home') {
      nav.askExit();
    } else {
      goHome();
    }
  });

  const profile = profiles.data?.find((p) => p.id === session.get()?.profileId);
  const profileName = profile?.name ?? session.get()?.user?.username ?? '';
  // A kids profile cannot leave the server it was given. Until the profile is known, assume it may be one.
  const restricted = profiles.isPending || profile?.is_child === true;

  return (
    <FocusTrackerContext.Provider value={report}>
      <main className="shell" data-testid="shell">
        <TopBar
          selected={selected}
          initialTab={initialTab}
          profileName={profileName}
          onTabFocused={tabFocused}
          onTabPick={select}
          onAvatar={() => setMenu('main')}
        />
        {/* Keyed by tab: the content of another tab is a new group that starts at its memory. */}
        <FocusGroup
          key={selected}
          focusKey={`shell-content-${selected}`}
          enterable
          className="shell-content"
          // A group with nothing focusable in it (still loading) takes no focus: the bar keeps it.
          onFocusSelf={() => void setFocus(tabKey(selectedRef.current))}
          saveLastFocusedChild
          preferredChildFocusKey={memory.focusOf(selected)}
          data-testid={`tab-${selected}`}
        >
          <TabContent tab={selected} onPlay={onPlay} onHome={goHome} />
        </FocusGroup>
        {menu ? (
          <AvatarMenu
            view={menu}
            profileName={profileName}
            serverName={branding.serverName}
            restricted={restricted}
            launchMode={launchMode}
            signingOut={signOut.isPending}
            onClose={() => setMenu(null)}
            onSwitchProfile={onSwitchProfile}
            onSwitchServer={onSwitchServer}
            onSignOut={() => setSignOutOpen(true)}
            onOpenLaunch={() => setMenu('launch')}
            onChooseLaunch={(mode) => {
              onLaunchMode(mode);
              setMenu('main');
            }}
          />
        ) : null}
        {signOutOpen ? (
          <SignOutDialog
            server={branding.serverName}
            busy={signOut.isPending}
            onCancel={() => setSignOutOpen(false)}
            onConfirm={() => signOut.mutate()}
          />
        ) : null}
        {offer && rendered ? (
          <LaunchOfferDialog
            name={offer.name}
            fallbackFocusKey={tabKey(selected)}
            onAnswer={offer.onAnswer}
          />
        ) : null}
      </main>
    </FocusTrackerContext.Provider>
  );
}
