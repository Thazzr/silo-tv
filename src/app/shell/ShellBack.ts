import { createContext, useContext, useEffect, useRef } from 'react';

/** Answers Back for the content of a tab: true when it closed something, false to let the shell act. */
export type ContentBack = () => boolean;

/** The shell's slot for the content's Back handler; null while nothing is registered. */
export const ShellBackContext = createContext<((handler: ContentBack | null) => void) | null>(null);

/**
 * Lets the content of a tab take Back first, for a popup or menu that is open over it. The shell
 * owns the screen's single Back handler, so content cannot install one of its own.
 */
export function useContentBack(handler: ContentBack): void {
  const register = useContext(ShellBackContext);
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
