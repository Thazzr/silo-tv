import { useContext, useEffect, useMemo, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { ArrowContext, type ArrowHandler } from './arrows';
import { getCurrentFocusKey } from './init';

export interface FocusGroupProps extends HTMLAttributes<HTMLDivElement> {
  focusKey: string;
  /**
   * Arrow keys can move the focus into this group from a sibling group (the shell's bar and
   * content). Off for screens and dialogs, which are entered by their own code.
   */
  enterable?: boolean;
  /** Called when the group itself holds the focus, which happens only while it has no focusable child. */
  onFocusSelf?: () => void;
  /** Arrow keys cannot leave the group (screens, dialogs). */
  boundary?: boolean;
  /** Focus another child when the focused one disappears; off for dialogs that restore it themselves. */
  autoRestoreFocus?: boolean;
  /** Entering the group (arrow keys, setFocus) lands on the element last focused inside it. */
  saveLastFocusedChild?: boolean;
  /** Where entering the group lands when nothing was focused inside it yet. */
  preferredChildFocusKey?: string;
  /**
   * Decides the arrow presses of everything inside the group (see ArrowHandler); presses it
   * declines go to the group above, then to the library's spatial search.
   */
  onArrow?: ArrowHandler;
  children: ReactNode;
}

/** A container of focusable elements; arrow keys move within it before they leave it. */
export function FocusGroup({
  focusKey,
  enterable = false,
  onFocusSelf,
  boundary = false,
  autoRestoreFocus = true,
  saveLastFocusedChild,
  preferredChildFocusKey,
  onArrow,
  children,
  ...rest
}: FocusGroupProps) {
  const parentArrow = useContext(ArrowContext);
  const handler = useRef(onArrow);
  useEffect(() => {
    handler.current = onArrow;
  });
  const hasHandler = onArrow !== undefined;
  const arrow = useMemo<ArrowHandler | null>(
    () =>
      hasHandler
        ? (direction, fromKey) =>
            handler.current?.(direction, fromKey) === true ||
            parentArrow?.(direction, fromKey) === true
        : parentArrow,
    [hasHandler, parentArrow],
  );
  const { ref, focusKey: key } = useFocusable<unknown, HTMLDivElement>({
    focusKey,
    focusable: enterable,
    // The service also reports focus that moved to a child; only the group itself counts here.
    onFocus: onFocusSelf
      ? () => {
          if (getCurrentFocusKey() === focusKey) onFocusSelf();
        }
      : undefined,
    isFocusBoundary: boundary,
    autoRestoreFocus,
    saveLastFocusedChild,
    preferredChildFocusKey,
  });
  return (
    <FocusContext.Provider value={key}>
      <ArrowContext.Provider value={arrow}>
        <div ref={ref} {...rest}>
          {children}
        </div>
      </ArrowContext.Provider>
    </FocusContext.Provider>
  );
}
