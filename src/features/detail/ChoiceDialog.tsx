import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  FocusGroup,
  doesFocusableExist,
  focusFromPointer,
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
  /** A second, quieter line under the label. */
  description?: string;
  /** Small tags beside the label; an outlined one is the quieter kind. */
  badges?: readonly { text: string; outlined?: boolean }[];
  /** In a list of options: whether this is the current one (it shows a check). */
  checked?: boolean;
  /** A heading over this choice and the ones after it that share it. */
  section?: string;
}

/**
 * A short list of choices over a page: the More menu, the "Resume playback?" question and the
 * lists of the audio, subtitle and version pills. The first choice has the focus (or `initialKey`),
 * Up and Down walk the list and hold at its ends, Left and Right do nothing, and Back (routed here)
 * closes it; the focus returns to the button that opened it. Every row is a full-width target, and
 * a list longer than the screen scrolls inside the dialog, keeping the focused row in view.
 */
export function ChoiceDialog({
  testId,
  label,
  title,
  description,
  choices,
  initialKey,
  note,
  onClose,
}: {
  testId: string;
  /** The accessible name when there is no visible title. */
  label: string;
  title?: string;
  description?: string;
  choices: readonly Choice[];
  /** The choice that has the focus when the dialog opens; the first one without it. */
  initialKey?: string;
  /** A line under the list (a list that is still loading, or has nothing to show). */
  note?: { text: string; busy?: boolean };
  onClose: () => void;
}) {
  const [previous] = useState(() => getCurrentFocusKey());
  const startKey = initialKey ?? choices[0]!.key;
  const list = useRef<HTMLDivElement>(null);
  const options = choices.some((choice) => choice.checked !== undefined);

  useBackHandler(onClose);
  useEffect(() => {
    void setFocus(startKey);
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

  // The pointer never scrolls (nav/origin.ts); a key press does, and nothing animates.
  const reveal = (key: string) => {
    if (focusFromPointer()) return;
    const row = Array.from(list.current?.querySelectorAll('[data-focus-key]') ?? []).find(
      (el) => el.getAttribute('data-focus-key') === key,
    );
    row?.scrollIntoView?.({ block: 'nearest' });
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
        <div
          ref={list}
          className="dialog-choice-list"
          role={options ? 'radiogroup' : undefined}
          aria-label={options ? (title ?? label) : undefined}
        >
          {choices.map((choice, index) => (
            <Fragment key={choice.key}>
              {choice.section && choice.section !== choices[index - 1]?.section ? (
                <h3 className="dialog-choice-section">{choice.section}</h3>
              ) : null}
              <Button
                focusKey={choice.key}
                className="detail-choice"
                role={options ? 'radio' : undefined}
                aria-checked={options ? choice.checked === true : undefined}
                onFocused={() => reveal(choice.key)}
                onClick={choice.onSelect}
              >
                {choice.icon}
                <span className="detail-choice-text">
                  <span className="detail-choice-label">
                    {choice.label}
                    {choice.badges?.map((badge) => (
                      <span
                        key={badge.text}
                        className="detail-choice-badge"
                        data-outlined={badge.outlined === true}
                      >
                        {badge.text}
                      </span>
                    ))}
                  </span>
                  {choice.description ? (
                    <span className="detail-choice-description">{choice.description}</span>
                  ) : null}
                </span>
                {choice.checked ? (
                  <Check className="detail-choice-check" size={32} aria-hidden="true" />
                ) : null}
              </Button>
            </Fragment>
          ))}
        </div>
        {note ? (
          <p className="dialog-choice-note" role="status">
            {note.busy ? <span className="spinner" aria-hidden="true" /> : null}
            {note.text}
          </p>
        ) : null}
      </FocusGroup>
    </div>
  );
}
