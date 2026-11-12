import { useCallback, useEffect, useRef } from 'react';
import { focusFromPointer } from './origin';

/**
 * A focus-within callback for a screen whose layout follows where the focus is (rows or carousel).
 * The pointer must never move such a layout (see origin.ts), so a change the pointer caused is only
 * remembered. The next key press brings the layout in line with the remembered state, which is
 * where the focus is when that press moves it within the group (no change is reported then) or
 * across its edge (the change is reported after the press and counts as the keys' own).
 *
 * Pass the result to `FocusGroup`'s `onFocusWithin`; `apply` must be stable or cheap to repeat.
 */
export function useKeyFocusWithin(apply: (within: boolean) => void): (within: boolean) => void {
  const applyRef = useRef(apply);
  const latest = useRef(false);
  useEffect(() => {
    applyRef.current = apply;
  });
  useEffect(() => {
    const onKey = () => applyRef.current(latest.current);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return useCallback((within: boolean) => {
    latest.current = within;
    if (!focusFromPointer()) applyRef.current(within);
  }, []);
}
