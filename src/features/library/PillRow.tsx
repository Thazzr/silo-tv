import { FocusGroup, Focusable } from '../../app/nav';

export interface PillItem {
  id: string;
  label: string;
}

/**
 * A row of pills, one of them selected (marked like the season pills). A focused pill is only a
 * candidate: the screen shows its content once the focus has rested on it (`onFocusPill`), and
 * OK shows it at once (`onPick`). Entering the row from below lands on the selected pill.
 */
export function PillRow({
  focusKey,
  keyPrefix,
  label,
  items,
  selected,
  onFocusPill,
  onPick,
  testId,
}: {
  focusKey: string;
  /** The pills' focus keys are this prefix and the item's id. */
  keyPrefix: string;
  label: string;
  items: readonly PillItem[];
  selected: string | undefined;
  onFocusPill: (id: string) => void;
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
          onFocused={() => onFocusPill(item.id)}
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </Focusable>
      ))}
    </FocusGroup>
  );
}
