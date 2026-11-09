import { useEffect } from 'react';
import { useT } from '../../i18n';
import { Focusable, FocusGroup, doesFocusableExist, setFocus } from '../nav';
import { AVATAR_KEY, MENU_KEY_PREFIX } from './tabs';

const FIRST_ITEM = `${MENU_KEY_PREFIX}profile`;

/**
 * The avatar's menu: switch profile, switch server, sign out. The focus is trapped in it, Back
 * (routed here by the shell) closes it, and closing puts the focus back on the avatar.
 */
export function AvatarMenu({
  profileName,
  serverName,
  signingOut,
  onClose,
  onSwitchProfile,
  onSwitchServer,
  onSignOut,
}: {
  profileName: string;
  serverName: string;
  signingOut: boolean;
  onClose: () => void;
  onSwitchProfile: () => void;
  onSwitchServer: () => void;
  onSignOut: () => void;
}) {
  const t = useT();

  // Not autoFocus: the screen frame already gave the focus to the tab bar, and it keeps that claim.
  useEffect(() => {
    void setFocus(FIRST_ITEM);
    return () => {
      if (doesFocusableExist(AVATAR_KEY)) void setFocus(AVATAR_KEY);
    };
  }, []);

  return (
    <div
      className="menu-backdrop"
      onClick={(e) => {
        // The pointer outside the menu closes it; a click on an item bubbles up here too.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <FocusGroup
        focusKey="avatar-menu"
        boundary
        autoRestoreFocus={false}
        className="menu"
        role="menu"
        aria-label={t('shell.menu.label')}
        data-testid="avatar-menu"
      >
        <div className="menu-header">
          <p className="menu-profile">{profileName}</p>
          <p className="menu-server">{serverName}</p>
        </div>
        <Focusable
          focusKey={FIRST_ITEM}
          role="menuitem"
          className="menu-item"
          onClick={onSwitchProfile}
        >
          {t('shell.menu.switchProfile')}
        </Focusable>
        <Focusable
          focusKey={`${MENU_KEY_PREFIX}server`}
          role="menuitem"
          className="menu-item"
          onClick={onSwitchServer}
        >
          {t('shell.menu.switchServer')}
        </Focusable>
        <Focusable
          focusKey={`${MENU_KEY_PREFIX}signout`}
          role="menuitem"
          className="menu-item danger"
          disabled={signingOut}
          onClick={onSignOut}
        >
          {t('shell.menu.signOut')}
        </Focusable>
      </FocusGroup>
    </div>
  );
}
