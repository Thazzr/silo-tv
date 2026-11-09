import { useEffect, useRef } from 'react';
import { useT, type MessageKey } from '../../i18n';
import { LAUNCH_MODES, type LaunchMode } from '../../features/profiles/launchPrefs';
import { Focusable, FocusGroup, doesFocusableExist, setFocus } from '../nav';
import { AVATAR_KEY, MENU_KEY_PREFIX } from './tabs';

const FIRST_ITEM = `${MENU_KEY_PREFIX}profile`;
const LAUNCH_ITEM = `${MENU_KEY_PREFIX}launch`;
const launchOptionKey = (mode: LaunchMode) => `${MENU_KEY_PREFIX}launch-${mode}`;

export const LAUNCH_LABELS: Record<LaunchMode, MessageKey> = {
  automatic: 'launch.automatic',
  every: 'launch.every',
  hour: 'launch.hour',
  halfday: 'launch.halfday',
};

/** The menu shows its entries, or the chooser of the "Profile at launch" setting. */
export type MenuView = 'main' | 'launch';

/**
 * The avatar's menu: switch profile, profile at launch, switch server, sign out. A restricted
 * (kids) profile gets no way off the server it was given: no server switch and no sign-out. The
 * focus is trapped in it, Back (routed here by the shell) closes it or leaves the chooser, and
 * closing puts the focus back on the avatar.
 */
export function AvatarMenu({
  view,
  profileName,
  serverName,
  restricted,
  launchMode,
  signingOut,
  onClose,
  onSwitchProfile,
  onSwitchServer,
  onSignOut,
  onOpenLaunch,
  onChooseLaunch,
}: {
  view: MenuView;
  profileName: string;
  serverName: string;
  restricted: boolean;
  launchMode: LaunchMode;
  signingOut: boolean;
  onClose: () => void;
  onSwitchProfile: () => void;
  onSwitchServer: () => void;
  onSignOut: () => void;
  onOpenLaunch: () => void;
  onChooseLaunch: (mode: LaunchMode) => void;
}) {
  const t = useT();
  const previousView = useRef<MenuView | null>(null);

  // Not autoFocus: the screen frame already gave the focus to the tab bar, and it keeps that claim.
  useEffect(() => {
    const returning = previousView.current === 'launch' && view === 'main';
    previousView.current = view;
    if (view === 'launch') void setFocus(launchOptionKey(launchMode));
    else void setFocus(returning ? LAUNCH_ITEM : FIRST_ITEM);
    // Only a change of view moves the focus; choosing a mode must not pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(
    () => () => {
      if (doesFocusableExist(AVATAR_KEY)) void setFocus(AVATAR_KEY);
    },
    [],
  );

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
        {view === 'main' ? (
          <>
            <div className="menu-header">
              <p className="menu-profile" data-testid="menu-profile">
                {profileName}
              </p>
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
              focusKey={LAUNCH_ITEM}
              role="menuitem"
              aria-haspopup="menu"
              className="menu-item menu-item-split"
              onClick={onOpenLaunch}
            >
              <span>{t('shell.menu.launch')}</span>
              <span className="menu-value" data-testid="launch-value">
                {t(LAUNCH_LABELS[launchMode])}
              </span>
            </Focusable>
            {restricted ? null : (
              <>
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
              </>
            )}
          </>
        ) : (
          <>
            <div className="menu-header">
              <p className="menu-profile">{t('launch.title')}</p>
              <p className="menu-server">{t('launch.hint')}</p>
            </div>
            {LAUNCH_MODES.map((mode) => (
              <Focusable
                key={mode}
                focusKey={launchOptionKey(mode)}
                role="menuitemradio"
                aria-checked={mode === launchMode}
                className="menu-item menu-item-split"
                onClick={() => onChooseLaunch(mode)}
              >
                <span>{t(LAUNCH_LABELS[mode])}</span>
                <span aria-hidden="true">{mode === launchMode ? '✓' : ''}</span>
              </Focusable>
            ))}
          </>
        )}
      </FocusGroup>
    </div>
  );
}
