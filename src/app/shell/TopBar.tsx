import { useT } from '../../i18n';
import { ServerMark } from '../../features/branding/components';
import { initialOf } from '../../features/branding/branding';
import { useBranding } from '../../features/branding/queries';
import { FocusGroup, Focusable } from '../nav';
import { AVATAR_KEY, TAB_IDS, TAB_LABELS, tabKey, type TabId } from './tabs';

/**
 * Server mark and name on the left, the tabs, and the avatar of the selected profile on the
 * right. Left and Right walk the tabs and the avatar; entering the bar from below lands on the
 * selected tab.
 */
export function TopBar({
  selected,
  initialTab,
  profileName,
  onTabPick,
  onAvatar,
}: {
  selected: TabId;
  /** The tab that takes the focus when the shell opens. */
  initialTab: TabId;
  profileName: string;
  /** OK or a click on a tab: its content shows; focus alone never does. */
  onTabPick: (tab: TabId) => void;
  onAvatar: () => void;
}) {
  const t = useT();
  const branding = useBranding();
  return (
    <FocusGroup
      focusKey="shell-bar"
      enterable
      // Entering the bar from below lands on the selected tab, not on the last one that was focused.
      saveLastFocusedChild={false}
      className="topbar"
      preferredChildFocusKey={tabKey(selected)}
      data-testid="topbar"
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
            autoFocus={tab === initialTab}
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
  );
}
