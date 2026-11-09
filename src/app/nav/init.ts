// The only place that talks to the spatial navigation library's service. Screens use the
// components and hooks exported from ./index.ts (an ESLint rule keeps the package out of every
// other file).
import {
  SpatialNavigation,
  destroy,
  init,
  setKeyMap,
  setFocus as libSetFocus,
  type SpatialNavigationServiceOptions,
} from '@noriginmedia/norigin-spatial-navigation';
import { NavAdapter } from './adapter';
import { clearPointerFocus, markPointerFocus, startOriginTracking } from './origin';
import { startWheelNavigation } from './wheel';

/** Options of the service (key handling, layout measuring); tests pass a fake layout. */
export type NavigationOptions = Partial<SpatialNavigationServiceOptions>;

/** Remote keys the library handles. Back is not among them: the screen stack owns it. */
export const NAV_KEYS = { left: 37, up: 38, right: 39, down: 40, enter: 13 } as const;

const TEXT_FIELD_KEYS: readonly number[] = [NAV_KEYS.left, NAV_KEYS.right, NAV_KEYS.enter];

export function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

// A text field keeps Left and Right (the caret) and Enter (submits the form; opens the virtual
// keyboard on webOS). The library would swallow them, so this capture-phase listener stops the
// event before the library's own listener sees it; the browser's default action still runs.
function guardTextField(e: KeyboardEvent): void {
  if (isTextField(e.target) && TEXT_FIELD_KEYS.includes(e.keyCode)) e.stopImmediatePropagation();
}

let teardown: (() => void) | null = null;

/** Starts the spatial navigation service; call once at startup (tests call it per test). */
export function initNavigation(options: NavigationOptions = {}): void {
  destroyNavigation();
  // shouldFocusDOMNode: the focused element also gets DOM focus, which text fields need for typing.
  // preventScroll: DOM focus must not scroll anything; the boxes that scroll by transform would
  // fight it, and the adapter brings the focused element into view where a box really scrolls.
  // The adapter is ours; a test's fake layout (an object) is laid over it, so only the measuring
  // is faked.
  const given = options.layoutAdapter;
  const layoutAdapter =
    typeof given === 'function'
      ? given
      : class extends NavAdapter {
          constructor(...args: ConstructorParameters<typeof NavAdapter>) {
            super(...args);
            if (given) Object.assign(this, given);
          }
        };
  init({
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true },
    ...options,
    layoutAdapter,
  });
  setKeyMap(NAV_KEYS);
  // Before the guard and the library: the listeners run in the order they were added.
  const stopOrigin = startOriginTracking();
  window.addEventListener('keydown', guardTextField, true);
  const stopWheel = startWheelNavigation();
  teardown = () => {
    stopWheel();
    stopOrigin();
    window.removeEventListener('keydown', guardTextField, true);
    destroy();
  };
}

export function destroyNavigation(): void {
  teardown?.();
  teardown = null;
}

export { getCurrentFocusKey, doesFocusableExist } from '@noriginmedia/norigin-spatial-navigation';

/** Moves the focus from code (a screen opening, focus memory, the arrow handlers): it scrolls. */
export function setFocus(focusKey: string): Promise<void> {
  clearPointerFocus();
  return libSetFocus(focusKey);
}

/** Moves the focus because the pointer hovers the element: the focus moves, nothing scrolls. */
export function setFocusFromPointer(focusKey: string): Promise<void> {
  markPointerFocus(focusKey);
  return libSetFocus(focusKey);
}

/** True when `focusKey` is focusable and sits somewhere below `ancestorKey`. */
export function isInside(focusKey: string | null, ancestorKey: string): boolean {
  if (!focusKey || focusKey === ancestorKey) return false;
  return (
    SpatialNavigation.doesFocusableExist(focusKey) &&
    SpatialNavigation.isDescendantOf(focusKey, ancestorKey)
  );
}
