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
  testId,
}: {
  focusKey: string;
  /** The pills' focus keys are this prefix and the item's id. */
  keyPrefix: string;
  label: string;
  items: readonly PillItem[];
  selected: string | undefined;
  onPick: (id: string) => void;
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
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </Focusable>
      ))}
    </FocusGroup>
  );
}
