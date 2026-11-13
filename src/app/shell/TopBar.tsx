import { useState } from 'react';
import { useT } from '../../i18n';
import { ServerMark } from '../../features/branding/components';
import { initialOf } from '../../features/branding/branding';
import { useBranding } from '../../features/branding/queries';
import { FocusGroup, Focusable, useKeyFocusWithin } from '../nav';
import { useContentAway } from './ShellBar';
import { AVATAR_KEY, TAB_IDS, TAB_LABELS, tabKey, type TabId } from './tabs';

/**
 * Server mark and name on the left, the tabs, and the avatar of the selected profile on the
 * right. Left and Right walk the tabs and the avatar; entering the bar from below lands on the
 * selected tab.
 *
 * The bar floats over the content and leaves while the content is `away` from its top. It stays,
 * or comes back, while a key has put the focus on it and while the pointer is on it; the pointer
 * reaches a hidden bar through a strip along the top edge. Neither the pointer's hover nor its
 * focus moves the content (see nav/origin.ts), so a hidden bar's hover focus does not keep it.
 */
export function TopBar({
  selected,
  initialTab,
  focusAvatar = false,
  profileName,
  onTabPick,
  onAvatar,
}: {
  selected: TabId;
  /** The tab that takes the focus when the shell opens. */
  initialTab: TabId;
  /** The avatar, not a tab, takes the focus when the shell opens (coming back from Settings). */
  focusAvatar?: boolean;
  profileName: string;
  /** OK or a click on a tab: its content shows; focus alone never does. */
  onTabPick: (tab: TabId) => void;
  onAvatar: () => void;
}) {
  const t = useT();
  const branding = useBranding();
  const [keyFocused, setKeyFocused] = useState(false);
  const [pointerOn, setPointerOn] = useState(false);
  const focusWithin = useKeyFocusWithin(setKeyFocused);
  const away = useContentAway();
  const hidden = away && !keyFocused && !pointerOn;
  return (
    <>
      <FocusGroup
        focusKey="shell-bar"
        enterable
        // Entering the bar from below lands on the selected tab, not on the last one that was focused.
        saveLastFocusedChild={false}
        className="topbar"
        preferredChildFocusKey={tabKey(selected)}
        data-testid="topbar"
        data-hidden={hidden}
        onFocusWithin={focusWithin}
        onMouseEnter={() => setPointerOn(true)}
        onMouseLeave={() => setPointerOn(false)}
      >
        <div className="topbar-brand">
          <ServerMark url={branding.markUrl} name={branding.serverName} />
          <span className="topbar-name" data-testid="server-name">
            {branding.serverName}
          </span>
        </div>
        <nav className="tabs" aria-label={t('shell.tabs')}>
          {TAB_IDS.map((tab) => (
            <Focusable
              key={tab}
              focusKey={tabKey(tab)}
              autoFocus={!focusAvatar && tab === initialTab}
              className="tab"
              aria-current={tab === selected ? 'page' : undefined}
              data-selected={tab === selected}
              onClick={() => onTabPick(tab)}
            >
              {t(TAB_LABELS[tab])}
            </Focusable>
          ))}
        </nav>
        <div className="topbar-end">
          <Focusable
            focusKey={AVATAR_KEY}
            autoFocus={focusAvatar}
            className="avatar-button"
            aria-label={t('shell.avatar', { name: profileName })}
            aria-haspopup="menu"
            onClick={onAvatar}
          >
            <span className="avatar" aria-hidden="true" data-testid="avatar">
              {initialOf(profileName)}
            </span>
          </Focusable>
        </div>
      </FocusGroup>
      {hidden ? (
        <div
          className="topbar-reveal"
          data-testid="topbar-reveal"
          aria-hidden="true"
          onMouseEnter={() => setPointerOn(true)}
        />
      ) : null}
    </>
  );
}
