import { createContext, useMemo, useRef, type ReactNode } from 'react';
import { FocusGroup } from './FocusGroup';
import { doesFocusableExist, getCurrentFocusKey, isInside, setFocus } from './init';

/** What a focusable element tells the screen it sits in. */
export interface FrameApi {
  onMounted(focusKey: string, autoFocus: boolean): void;
  onUnmounted(focusKey: string): void;
}

export const FrameContext = createContext<FrameApi | null>(null);

/**
 * Content that sets its own focus when it appears (a panel that opens on a remembered row): the
 * screen does not claim the focus for the first element of it, which would land before the
 * panel's own choice and fire the focus handlers of an element the viewer never moved to.
 */
export function SelfFocusing({ children }: { children: ReactNode }) {
  return <FrameContext.Provider value={null}>{children}</FrameContext.Provider>;
}

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
  const restored = useRef<string | null>(null);

  const api = useMemo<FrameApi>(
    () => ({
      onMounted(key, autoFocus) {
        if (pending.current === key) {
          pending.current = null;
          claim.current = { kind: 'strong', key };
          void setFocus(key);
          // Remembered until this commit's effects are done (a microtask), not longer: React's
          // StrictMode (development) undoes the effects and runs them again within that flush, see
          // `onUnmounted`. A card that is really remounted later must not take the focus back.
          restored.current = key;
          void Promise.resolve().then(() => {
            if (restored.current === key) restored.current = null;
          });
          return;
        }
        if (autoFocus) {
          if (claim.current?.kind === 'strong') return;
          if (pending.current) {
            if (doesFocusableExist(pending.current)) return;
            // The element the viewer came from may mount a moment later in this same commit
            // (it comes after this one in the tree). Claiming now would start a second focus
            // move that can finish after the restore and win, so decide once the commit is done.
            // The plain claim keeps the elements that mount after this one from taking the focus.
            claim.current = { kind: 'plain', key };
            void Promise.resolve().then(() => {
              // Another claim (the restored element) or an unmount has taken over meanwhile.
              if (claim.current?.kind !== 'plain' || claim.current.key !== key) return;
              if (pending.current && doesFocusableExist(pending.current)) return;
              claim.current = { kind: 'strong', key };
              void setFocus(key);
            });
            return;
          }
          claim.current = { kind: 'strong', key };
          void setFocus(key);
          return;
        }
        if (claim.current || isInside(getCurrentFocusKey(), frameKey)) return;
        claim.current = { kind: 'plain', key };
        void setFocus(key);
      },
      onUnmounted(key) {
        // The element that was just restored is undone before the commit ends: its effects will
        // run again, and the second run must find the target as the first one did.
        if (restored.current === key) pending.current = key;
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
