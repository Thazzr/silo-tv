import type { HTMLAttributes, ReactNode } from 'react';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
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
  children,
  ...rest
}: FocusGroupProps) {
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
      <div ref={ref} {...rest}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
