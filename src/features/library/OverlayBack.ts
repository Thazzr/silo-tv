import { createContext, useContext, useEffect, useRef } from 'react';

/** Answers Back for an open list or panel: true when it consumed the key, false to let it close. */
export type OverlayBack = () => boolean;

/** The library screen's slot for the Back handler of the list or panel that is open over it. */
export const OverlayBackContext = createContext<((handler: OverlayBack | null) => void) | null>(
  null,
);

/**
 * Lets a panel with more than one level take Back for its inner levels (a facet's values go back
 * to the list of facets) before the screen closes it. The screen owns the one Back route.
 */
export function useOverlayBack(handler: OverlayBack): void {
  const register = useContext(OverlayBackContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!register) return;
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}
