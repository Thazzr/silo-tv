import { useCallback, useEffect, useRef, useState } from 'react';
import { useBranding } from '../../features/branding/queries';
import type { DetailTarget } from '../../features/detail/detailMemory';
import { HomeScreen } from '../../features/home/HomeScreen';
import { keepAtOrigin } from '../../ui/media';
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
import { ShellBackContext, type ContentBack } from './ShellBack';
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
  /** Opens the detail page of a movie or series; the screen stack keeps the shell underneath. */
  onOpenDetail: (target: DetailTarget) => void;
  /** Opens the full list of a Home row ("Explore all") as a screen of its own. */
  onExploreSection?: (section: { id: string; title: string }) => void;
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
  memory,
  onPlay,
  onOpenDetail,
  onExploreSection,
  onHome,
}: {
  tab: TabId;
  memory: ShellMemory;
  onPlay: (item: CatalogItem) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onExploreSection: (section: { id: string; title: string }) => void;
  onHome: () => void;
}) {
  switch (tab) {
    case 'home':
      return (
        <HomeScreen
          rowMemory={memory.rows}
          onPlay={onPlay}
          onOpenDetail={onOpenDetail}
          onExploreSection={onExploreSection}
        />
      );
    case 'movies':
      return <TitleList kind="movie" onPlay={onPlay} onOpenDetail={onOpenDetail} />;
    case 'series':
      return <TitleList kind="series" onPlay={onPlay} onOpenDetail={onOpenDetail} />;
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
  onOpenDetail,
  onExploreSection = () => undefined,
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
  // Content with a popup of its own (Home's removal question) takes Back before the shell does.
  const contentBack = useRef<ContentBack | null>(null);
  const registerContentBack = useCallback((handler: ContentBack | null) => {
    contentBack.current = handler;
  }, []);

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
    if (contentBack.current?.()) return;
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
    <ShellBackContext.Provider value={registerContentBack}>
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
            className={selected === 'home' ? 'shell-content shell-content-home' : 'shell-content'}
            // A group with nothing focusable in it (still loading) takes no focus: the bar keeps it.
            onFocusSelf={() => void setFocus(tabKey(selectedRef.current))}
            saveLastFocusedChild
            // Home clips its content; focus must not scroll that box (the rows scroll by transform).
            onScroll={keepAtOrigin}
            preferredChildFocusKey={memory.focusOf(selected)}
            data-testid={`tab-${selected}`}
          >
            <TabContent
              tab={selected}
              memory={memory}
              onPlay={onPlay}
              onOpenDetail={onOpenDetail}
              onExploreSection={onExploreSection}
              onHome={goHome}
            />
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
    </ShellBackContext.Provider>
  );
}
