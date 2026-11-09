import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { Focusable, FocusGroup, doesFocusableExist, getCurrentFocusKey, setFocus } from '../nav';

/**
 * "Open {name} automatically next time?" over the first screen after the picker. Yes makes the
 * profile at launch Automatic; No (or Back) keeps asking every time. The arrow keys cannot leave
 * the dialog, and closing puts the focus back where it was, or on `fallbackFocusKey`.
 */
export function LaunchOfferDialog({
  name,
  fallbackFocusKey,
  onAnswer,
}: {
  name: string;
  fallbackFocusKey: string;
  onAnswer: (automatic: boolean) => void;
}) {
  const t = useT();
  // Read once, while the dialog is mounting.
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(() => {
    void setFocus('launch-offer-yes');
    return () => {
      const target = previous && doesFocusableExist(previous) ? previous : fallbackFocusKey;
      if (doesFocusableExist(target)) void setFocus(target);
    };
  }, [previous, fallbackFocusKey]);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="launch-offer"
        boundary
        autoRestoreFocus={false}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-offer-title"
        data-testid="launch-offer"
      >
        <h2 id="launch-offer-title">{t('launch.offer.title', { name })}</h2>
        <p className="note">{t('launch.offer.hint')}</p>
        <div className="dialog-actions">
          <Focusable focusKey="launch-offer-yes" className="btn" onClick={() => onAnswer(true)}>
            {t('launch.offer.yes')}
          </Focusable>
          <Focusable focusKey="launch-offer-no" className="btn" onClick={() => onAnswer(false)}>
            {t('launch.offer.no')}
          </Focusable>
        </div>
      </FocusGroup>
    </div>
  );
}
