import { useEffect, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';

const CANCEL_KEY = 'signout-cancel';

/**
 * "Sign out of {server}?" over the profile picker, so nobody signs the household out by accident
 * (a child at the picker). Cancel has the focus first and the arrow keys cannot leave the dialog;
 * the screen routes Back to `onCancel`.
 */
export function SignOutDialog({
  server,
  busy,
  onCancel,
  onConfirm,
}: {
  server: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(() => {
    void setFocus(CANCEL_KEY);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
  }, [previous]);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="signout-dialog"
        boundary
        autoRestoreFocus={false}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        data-testid="signout-dialog"
      >
        <h2 id="signout-title">{t('profiles.signOut.title', { server })}</h2>
        <div className="dialog-actions">
          <Focusable focusKey={CANCEL_KEY} className="btn" disabled={busy} onClick={onCancel}>
            {t('profiles.signOut.cancel')}
          </Focusable>
          <Focusable
            focusKey="signout-confirm"
            className="btn danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {t('profiles.signOut.confirm')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
