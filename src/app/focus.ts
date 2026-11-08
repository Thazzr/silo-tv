import { useEffect, useRef, type RefObject } from 'react';
import { mapKey } from '../platform/keys';

// Phase 0 focus handling: a screen is a vertical list of elements marked `data-focusable`, and a
// container marked `data-columns="n"` inside it is a grid (digit pad). Phase 1 replaces this with
// the real focus manager.
export const FOCUSABLE = '[data-focusable]:not([disabled])';

function items(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function isTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Index to move to for an arrow key, or null to stay. */
function targetIndex(
  list: HTMLElement[],
  index: number,
  key: 'up' | 'down' | 'left' | 'right',
): number | null {
  const current = list[index];
  const grid = current?.closest<HTMLElement>('[data-columns]');
  if (current && grid) {
    const columns = Number(grid.dataset.columns) || 1;
    const members = list.filter((el) => grid.contains(el));
    const first = list.indexOf(members[0]!);
    const last = first + members.length - 1;
    if (key === 'left') return index > first ? index - 1 : null;
    if (key === 'right') return index < last ? index + 1 : null;
    if (key === 'down') {
      if (index + columns <= last) return index + columns;
      return last + 1 < list.length ? last + 1 : null;
    }
    if (index - columns >= first) return index - columns;
    return first > 0 ? first - 1 : null;
  }
  if (key === 'left' || key === 'right') return null;
  if (key === 'up') return index > 0 ? index - 1 : null;
  return index < list.length - 1 ? index + 1 : null;
}

/**
 * Arrow keys move focus, Enter activates the focused element, Back calls `onBack`, and the Magic
 * Remote pointer focuses what it hovers. When the focused element disappears (a list replaces a
 * loading cue) focus moves to the first element again.
 */
export function useFocusNavigation(ref: RefObject<HTMLElement | null>, onBack?: () => void): void {
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // A `data-autofocus` element that newly appears (a list that finished loading) takes the
    // focus even when something else on the screen has it; after that the user decides.
    let claimed: Element | null = null;
    const ensureFocus = () => {
      const wanted = container.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
      if (wanted && wanted !== claimed) {
        claimed = wanted;
        wanted.focus();
        return;
      }
      const active = document.activeElement;
      if (active && active !== container && container.contains(active)) return;
      const first =
        container.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
        container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = mapKey(e);
      if (key === 'back') {
        // Backspace edits text in a field; every other Back key leaves the screen.
        if (e.keyCode === 8 && isTextField(e.target)) return;
        e.preventDefault();
        backRef.current?.();
        return;
      }
      if (key === 'enter') {
        // A text field keeps Enter: on webOS it opens or closes the virtual keyboard.
        if (isTextField(e.target)) return;
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          container.contains(active) &&
          active.matches(FOCUSABLE)
        ) {
          // preventDefault stops the browser's own click for a button, so it fires only once.
          e.preventDefault();
          active.click();
        }
        return;
      }
      if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
        // Left and right move the caret inside a text field.
        if ((key === 'left' || key === 'right') && isTextField(e.target)) return;
        const list = items(container);
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (key === 'up' || key === 'down') e.preventDefault();
        if (index < 0) {
          if (key === 'up' || key === 'down') list[0]?.focus();
          return;
        }
        const next = targetIndex(list, index, key);
        if (next !== null) {
          e.preventDefault();
          list[next]?.focus();
        }
      }
    };

    const onPointer = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>(FOCUSABLE);
      if (el && container.contains(el) && el !== document.activeElement) {
        el.focus({ preventScroll: true });
      }
    };

    const observer = new MutationObserver(ensureFocus);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    window.addEventListener('keydown', onKeyDown);
    container.addEventListener('mouseover', onPointer);
    ensureFocus();
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('mouseover', onPointer);
    };
  }, [ref]);
}
