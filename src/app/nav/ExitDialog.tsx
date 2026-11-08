import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { getPlatform } from '../../platform';
import { Focusable } from './Focusable';
import { FocusGroup } from './FocusGroup';
import { doesFocusableExist, getCurrentFocusKey, setFocus } from './init';

/**
 * "Exit the app?" over the current screen. Cancel has the focus first and the arrow keys cannot
 * leave the dialog. Closing it (Cancel, or Back which the Navigator routes to `onClose`) puts the
 * focus back where it was; Exit asks the platform to close the app and then closes the popup too,
 * which is what remains visible where the platform cannot close the app (the browser).
 */
export function ExitDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  // What had the focus before the dialog opened; read once, while the dialog is mounting.
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(
    () => () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    },
    [previous],
  );

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="exit-dialog"
        boundary
        autoRestoreFocus={false}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-dialog-title"
        data-testid="exit-dialog"
      >
        <h2 id="exit-dialog-title">{t('exit.title')}</h2>
        <div className="dialog-actions">
          <Focusable focusKey="exit-cancel" autoFocus className="btn" onClick={onClose}>
            {t('exit.cancel')}
          </Focusable>
          <Focusable
            focusKey="exit-confirm"
            className="btn danger"
            onClick={() => {
              getPlatform().exitApp();
              // Where the app cannot be closed (the browser) nothing happened: back to the screen.
              onClose();
            }}
          >
            {t('exit.confirm')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
