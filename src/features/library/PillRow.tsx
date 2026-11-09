import { FocusGroup, Focusable } from '../../app/nav';

export interface PillItem {
  id: string;
  label: string;
}

/**
 * A row of pills, one of them selected (marked like the season pills). Focus and hover only move
 * the highlight; OK or a click shows a pill's content (`onPick`). Entering the row from below lands on the selected pill.
 */
export function PillRow({
  focusKey,
  keyPrefix,
  label,
  items,
  selected,
  onPick,
  onFocused,
  autoFocus = false,
  testId,
}: {
  focusKey: string;
  /** The pills' focus keys are this prefix and the item's id. */
  keyPrefix: string;
  label: string;
  items: readonly PillItem[];
  selected: string | undefined;
  onPick: (id: string) => void;
  /** Any pill got the focus (for a screen that scrolls with it). */
  onFocused?: () => void;
  /** The selected pill takes the focus when the row appears. */
  autoFocus?: boolean;
  testId: string;
}) {
  return (
    <FocusGroup
      focusKey={focusKey}
      enterable
      saveLastFocusedChild={false}
      preferredChildFocusKey={selected === undefined ? undefined : `${keyPrefix}${selected}`}
      className="lib-pills"
      role="tablist"
      aria-label={label}
      data-testid={testId}
    >
      {items.map((item) => (
        <Focusable
          key={item.id}
          focusKey={`${keyPrefix}${item.id}`}
          className={`btn lib-pill${item.id === selected ? ' selected' : ''}`}
          role="tab"
          aria-selected={item.id === selected}
          autoFocus={autoFocus && item.id === selected}
          onFocused={onFocused}
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </Focusable>
      ))}
    </FocusGroup>
  );
}
