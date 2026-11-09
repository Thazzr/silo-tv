import { useEffect, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';

const CANCEL_KEY = 'remove-server-cancel';

/**
 * "Remove this server?" over the server list. Cancel has the focus first and the arrow keys
 * cannot leave the dialog; the screen routes Back to `onCancel`. Closing puts the focus back on
 * the element that opened the dialog, when that still exists.
 */
export function RemoveServerDialog({
  name,
  removing,
  onCancel,
  onConfirm,
}: {
  name: string;
  /** The server is being removed (signing out on it may take a moment). */
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());

  // Not autoFocus: the screen frame already gave its focus claim to the list, and keeps it.
  useEffect(() => {
    void setFocus(CANCEL_KEY);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
  }, [previous]);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="remove-server-dialog"
        boundary
        autoRestoreFocus={false}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-server-title"
        data-testid="remove-server-dialog"
      >
        <h2 id="remove-server-title">{t('servers.remove.title')}</h2>
        <p>{t('servers.remove.text', { name })}</p>
        <div className="dialog-actions">
          <Focusable focusKey={CANCEL_KEY} className="btn" disabled={removing} onClick={onCancel}>
            {t('servers.remove.cancel')}
          </Focusable>
          <Focusable
            focusKey="remove-server-confirm"
            className="btn danger"
            disabled={removing}
            onClick={onConfirm}
          >
            {removing ? t('servers.remove.removing') : t('servers.remove.confirm')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
