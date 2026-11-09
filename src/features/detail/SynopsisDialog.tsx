import { useEffect, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';

const CLOSE_KEY = 'synopsis-close';

/**
 * The full synopsis over the detail page. Close has the focus and the arrow keys cannot leave the
 * dialog; the page routes Back to `onClose`, and the focus returns to the button that opened it.
 */
export function SynopsisDialog({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(() => {
    void setFocus(CLOSE_KEY);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
  }, [previous]);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="synopsis-dialog"
        boundary
        autoRestoreFocus={false}
        className="dialog dialog-synopsis"
        role="dialog"
        aria-modal="true"
        aria-labelledby="synopsis-title"
        data-testid="synopsis-dialog"
      >
        <h2 id="synopsis-title">{title}</h2>
        <p className="synopsis-full" data-testid="synopsis-full">
          {text}
        </p>
        <div className="dialog-actions">
          <Focusable focusKey={CLOSE_KEY} className="btn" onClick={onClose}>
            {t('detail.close')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
