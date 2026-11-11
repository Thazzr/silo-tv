import { useEffect, useState, type ReactNode } from 'react';
import {
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  moveFocusTo,
  setFocus,
  useBackHandler,
  type ArrowHandler,
} from '../../app/nav';
import { Button } from '../../app/ui';

export interface Choice {
  /** Must be unique and stable: it is the choice's focus key. */
  key: string;
  label: string;
  icon?: ReactNode;
  /** Runs when the choice is activated; the dialog's owner closes it. */
  onSelect: () => void;
}

/**
 * A short list of choices over a page: the More menu and the "Resume playback?" question. The
 * first choice has the focus, Up and Down walk the list and hold at its ends, Left and Right do
 * nothing, and Back (routed here) closes it; the focus returns to the button that opened it.
 * Every row is a full-width target.
 */
export function ChoiceDialog({
  testId,
  label,
  title,
  description,
  choices,
  onClose,
}: {
  testId: string;
  /** The accessible name when there is no visible title. */
  label: string;
  title?: string;
  description?: string;
  choices: readonly Choice[];
  onClose: () => void;
}) {
  const [previous] = useState(() => getCurrentFocusKey());
  const firstKey = choices[0]!.key;

  useBackHandler(onClose);
  useEffect(() => {
    void setFocus(firstKey);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
    // Once per mount: the dialog claims the focus when it opens and gives it back when it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up and Down walk the list by index. Every other press, and Up or Down past an end, is left to
  // the group's focus boundary, which keeps the focus inside the dialog.
  const onArrow: ArrowHandler = (direction, fromKey) => {
    if (direction !== 'up' && direction !== 'down') return false;
    const at = choices.findIndex((choice) => choice.key === fromKey);
    const target = choices[at + (direction === 'down' ? 1 : -1)];
    return target === undefined ? false : moveFocusTo(target.key);
  };

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey={`detail-dialog-${testId}`}
        boundary
        autoRestoreFocus={false}
        onArrow={onArrow}
        className="dialog dialog-choices"
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? `${testId}-title` : undefined}
        data-testid={testId}
      >
        {title ? <h2 id={`${testId}-title`}>{title}</h2> : null}
        {description ? <p className="dialog-description">{description}</p> : null}
        <div className="dialog-choice-list">
          {choices.map((choice) => (
            <Button
              key={choice.key}
              focusKey={choice.key}
              className="detail-choice"
              onClick={choice.onSelect}
            >
              {choice.icon}
              {choice.label}
            </Button>
          ))}
        </div>
      </FocusGroup>
    </div>
  );
}
