import { useEffect, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';
import type { DismissSurface } from './queries';

const CANCEL_KEY = 'remove-cancel';

/**
 * "Remove {title} from Continue Watching?" over Home. Cancel has the focus first and the arrow keys cannot
 * leave the dialog; the screen routes Back to `onCancel`, and the focus returns to the card.
 */
export function RemoveDialog({
  surface,
  title,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  surface: DismissSurface;
  /** What is removed: the movie, or the series of an episode (the server drops the whole show). */
  title: string;
  busy: boolean;
  failed: boolean;
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
        focusKey="remove-dialog"
        boundary
        autoRestoreFocus={false}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        data-testid="remove-dialog"
      >
        <h2 id="remove-title">
          {t(surface === 'next_up' ? 'home.remove.nextUp' : 'home.remove.continueWatching', {
            title,
          })}
        </h2>
        {failed ? (
          <p role="alert" className="error">
            {t('home.remove.failed')}
          </p>
        ) : null}
        <div className="dialog-actions">
          <Focusable focusKey={CANCEL_KEY} className="btn" disabled={busy} onClick={onCancel}>
            {t('home.remove.cancel')}
          </Focusable>
          <Focusable
            focusKey="remove-confirm"
            className="btn danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {t('home.remove.confirm')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
