import type { HTMLAttributes, ReactNode } from 'react';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';

export interface FocusGroupProps extends HTMLAttributes<HTMLDivElement> {
  focusKey: string;
  /** Arrow keys cannot leave the group (screens, dialogs). */
  boundary?: boolean;
  /** Focus another child when the focused one disappears; off for dialogs that restore it themselves. */
  autoRestoreFocus?: boolean;
  children: ReactNode;
}

/** A container of focusable elements; arrow keys move within it before they leave it. */
export function FocusGroup({
  focusKey,
  boundary = false,
  autoRestoreFocus = true,
  children,
  ...rest
}: FocusGroupProps) {
  const { ref, focusKey: key } = useFocusable<unknown, HTMLDivElement>({
    focusKey,
    focusable: false,
    isFocusBoundary: boundary,
    autoRestoreFocus,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} {...rest}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
