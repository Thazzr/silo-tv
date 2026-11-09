import type { MessageKey } from '../../i18n';
import { LibraryMemory } from '../../features/library/libraryMemory';
import { FocusIndexMemory } from '../../ui/media/scroll';

export const TAB_IDS = ['home', 'movies', 'series', 'forYou', 'calendar', 'search'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, MessageKey> = {
  home: 'shell.tab.home',
  movies: 'shell.tab.movies',
  series: 'shell.tab.series',
  forYou: 'shell.tab.forYou',
  calendar: 'shell.tab.calendar',
  search: 'shell.tab.search',
};

/** Focus keys of the shell's own elements; everything else inside the shell is content. */
export const TAB_KEY_PREFIX = 'shell-tab-';
export const AVATAR_KEY = 'shell-avatar';
export const MENU_KEY_PREFIX = 'avatar-menu-';

export const tabKey = (tab: TabId): string => `${TAB_KEY_PREFIX}${tab}`;

export function tabOfKey(focusKey: string): TabId | null {
  if (!focusKey.startsWith(TAB_KEY_PREFIX)) return null;
  const id = focusKey.slice(TAB_KEY_PREFIX.length);
  return (TAB_IDS as readonly string[]).includes(id) ? (id as TabId) : null;
}

/**
 * What the shell remembers while another screen (the player) is on top of it: the selected tab
 * and, per tab, the content element that had the focus. The screen stack unmounts the shell
 * then, so this lives with the flow, not in the shell.
 */
export class ShellMemory {
  tab: TabId = 'home';
  private focus: Partial<Record<TabId, string>> = {};
  /** The focused card of every Home row; the rows read it when they are shown again. */
  readonly rows = new FocusIndexMemory();
  /** The library, sub-view, Browse choices and focus of the Movies and Series tabs. */
  readonly library = new LibraryMemory();

  selectTab(tab: TabId): void {
    this.tab = tab;
  }

  rememberFocus(tab: TabId, focusKey: string): void {
    this.focus[tab] = focusKey;
  }

  focusOf(tab: TabId): string | undefined {
    return this.focus[tab];
  }

  /** A new visit (another profile, a fresh sign-in) starts on Home with nothing remembered. */
  reset(): void {
    this.tab = 'home';
    this.focus = {};
    this.rows.clear();
    this.library.reset();
  }
}
