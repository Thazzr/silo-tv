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
import { AvatarMenu } from './AvatarMenu';
import { ComingSoon } from './ComingSoon';
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
  const [menuOpen, setMenuOpen] = useState(false);
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
    if (menuOpen) {
      setMenuOpen(false);
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

  return (
    <FocusTrackerContext.Provider value={report}>
      <main className="shell" data-testid="shell">
        <TopBar
          selected={selected}
          initialTab={initialTab}
          profileName={profileName}
          onTabFocused={tabFocused}
          onTabPick={select}
          onAvatar={() => setMenuOpen(true)}
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
        {menuOpen ? (
          <AvatarMenu
            profileName={profileName}
            serverName={branding.serverName}
            signingOut={signOut.isPending}
            onClose={() => setMenuOpen(false)}
            onSwitchProfile={onSwitchProfile}
            onSwitchServer={onSwitchServer}
            onSignOut={() => signOut.mutate()}
          />
        ) : null}
      </main>
    </FocusTrackerContext.Provider>
  );
}
