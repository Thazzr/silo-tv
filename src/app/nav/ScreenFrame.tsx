import { createContext, useMemo, useRef, type ReactNode } from 'react';
import { FocusGroup } from './FocusGroup';
import { doesFocusableExist, getCurrentFocusKey, isInside, setFocus } from './init';

/** What a focusable element tells the screen it sits in. */
export interface FrameApi {
  onMounted(focusKey: string, autoFocus: boolean): void;
  onUnmounted(focusKey: string): void;
}

export const FrameContext = createContext<FrameApi | null>(null);

type Claim = { kind: 'plain' | 'strong'; key: string };

/**
 * One screen of the stack. It decides who gets the focus when elements appear:
 * 1. the element the user came from (focus memory, `restoreKey`) always wins;
 * 2. an element marked `autoFocus` wins over a plain one, also when it appears later (a list
 *    that finished loading);
 * 3. otherwise the first element that appears takes the focus when nothing on the screen has it.
 */
export function ScreenFrame({
  entryId,
  restoreKey,
  blocked,
  children,
}: {
  entryId: number;
  restoreKey: string | null;
  /** A modal is open over the screen: the pointer must not reach it. */
  blocked: boolean;
  children: ReactNode;
}) {
  const frameKey = `screen:${entryId}`;
  const pending = useRef<string | null>(restoreKey);
  const claim = useRef<Claim | null>(null);

  const api = useMemo<FrameApi>(
    () => ({
      onMounted(key, autoFocus) {
        if (pending.current === key) {
          pending.current = null;
          claim.current = { kind: 'strong', key };
          void setFocus(key);
          return;
        }
        if (autoFocus) {
          if (claim.current?.kind === 'strong') return;
          if (pending.current && doesFocusableExist(pending.current)) return;
          claim.current = { kind: 'strong', key };
          void setFocus(key);
          return;
        }
        if (claim.current || isInside(getCurrentFocusKey(), frameKey)) return;
        claim.current = { kind: 'plain', key };
        void setFocus(key);
      },
      onUnmounted(key) {
        if (claim.current?.key === key) claim.current = null;
      },
    }),
    [frameKey],
  );

  return (
    <FocusGroup focusKey={frameKey} boundary className="screen-frame" data-blocked={blocked}>
      <FrameContext.Provider value={api}>{children}</FrameContext.Provider>
    </FocusGroup>
  );
}
