import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getPlatform } from '../../platform';
import { ExitDialog } from './ExitDialog';
import { ScreenFrame } from './ScreenFrame';
import { getCurrentFocusKey, isInside, isTextField } from './init';

/** Stack operations a screen can call. `S` describes one screen (its name and parameters). */
export interface NavApi<S> {
  /** Opens a screen over the current one; Back returns to the current one. */
  push(screen: S): void;
  /** Closes the current screen (does nothing on the root entry). */
  pop(): void;
  /** Swaps the current screen for another one. */
  replace(screen: S): void;
  /** Drops the whole stack; the screen becomes the root entry. */
  reset(screen: S): void;
  /** Number of entries; 1 means the current screen is the root. */
  readonly depth: number;
  readonly current: S;
}

interface Entry<S> {
  id: number;
  screen: S;
  /** The focus key that was focused when another screen was pushed over this one. */
  lastFocus: string | null;
}

const NavApiContext = createContext<NavApi<never> | null>(null);

interface NavInternals {
  setBackHandler(handler: (() => void) | null): void;
}
const NavInternalsContext = createContext<NavInternals | null>(null);

export function useNavigator<S>(): NavApi<S> {
  const api = useContext(NavApiContext);
  if (!api) throw new Error('useNavigator needs a Navigator');
  return api as unknown as NavApi<S>;
}

/**
 * Takes over Back while the calling screen is shown (a PIN prompt that returns to the profile
 * list, a player that stops first). Without a handler Back pops the stack, or asks to exit on
 * the root entry. Does nothing outside a Navigator.
 */
export function useBackHandler(handler: (() => void) | undefined): void {
  const internals = useContext(NavInternalsContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const active = handler !== undefined;
  useEffect(() => {
    if (!internals || !active) return;
    internals.setBackHandler(() => latest.current?.());
    return () => internals.setBackHandler(null);
  }, [internals, active]);
}

/** Renders the top screen in a component of its own, so `renderScreen` runs outside this one's render. */
function ScreenHost<S>({
  screen,
  api,
  render,
}: {
  screen: S;
  api: NavApi<S>;
  render: NavigatorProps<S>['renderScreen'];
}) {
  return render(screen, api);
}

export interface NavigatorProps<S> {
  initial: S;
  /** Called on every render with the top screen; keep screen state out of the stack entries. */
  renderScreen: (screen: S, api: NavApi<S>) => ReactNode;
  /** Rendered next to the screens, inside the navigator's contexts (watchers, overlays). */
  children?: ReactNode;
}

/**
 * The screen stack. Only the top screen is mounted; when a screen is left through `push`, the
 * focused element's key is stored with it, and when it becomes the top again that element gets
 * the focus back (Back lands on the card you came from).
 */
export function Navigator<S>({ initial, renderScreen, children }: NavigatorProps<S>) {
  const nextId = useRef(1);
  const [stack, setStack] = useState<Entry<S>[]>(() => [
    { id: 0, screen: initial, lastFocus: null },
  ]);
  const stackRef = useRef(stack);
  const [exitOpen, setExitOpen] = useState(false);
  const exitOpenRef = useRef(false);
  const backHandler = useRef<(() => void) | null>(null);

  const commit = useCallback((next: Entry<S>[]) => {
    stackRef.current = next;
    setStack(next);
  }, []);

  const push = useCallback(
    (screen: S) => {
      const current = stackRef.current;
      const top = current[current.length - 1]!;
      const focused = getCurrentFocusKey();
      const lastFocus = isInside(focused, `screen:${top.id}`) ? focused : null;
      commit([
        ...current.slice(0, -1),
        { ...top, lastFocus },
        { id: nextId.current++, screen, lastFocus: null },
      ]);
    },
    [commit],
  );
  const pop = useCallback(() => {
    const current = stackRef.current;
    if (current.length > 1) commit(current.slice(0, -1));
  }, [commit]);
  const replace = useCallback(
    (screen: S) => {
      commit([...stackRef.current.slice(0, -1), { id: nextId.current++, screen, lastFocus: null }]);
    },
    [commit],
  );
  const reset = useCallback(
    (screen: S) => commit([{ id: nextId.current++, screen, lastFocus: null }]),
    [commit],
  );

  const setExit = useCallback((open: boolean) => {
    exitOpenRef.current = open;
    setExitOpen(open);
  }, []);

  const top = stack[stack.length - 1]!;
  const api = useMemo<NavApi<S>>(
    () => ({ push, pop, replace, reset, depth: stack.length, current: top.screen }),
    [push, pop, replace, reset, stack.length, top.screen],
  );
  const internals = useMemo<NavInternals>(
    () => ({
      setBackHandler: (handler) => {
        backHandler.current = handler;
      },
    }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (getPlatform().mapKey(e) !== 'back') return;
      // Backspace edits text in a field; every other Back key leaves the screen.
      if (e.keyCode === 8 && isTextField(e.target)) return;
      e.preventDefault();
      if (exitOpenRef.current) setExit(false);
      else if (backHandler.current) backHandler.current();
      else if (stackRef.current.length > 1) pop();
      else setExit(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pop, setExit]);

  return (
    <NavApiContext.Provider value={api as unknown as NavApi<never>}>
      <NavInternalsContext.Provider value={internals}>
        <ScreenFrame key={top.id} entryId={top.id} restoreKey={top.lastFocus} blocked={exitOpen}>
          <ScreenHost screen={top.screen} api={api} render={renderScreen} />
        </ScreenFrame>
        {children}
        {exitOpen ? <ExitDialog onClose={() => setExit(false)} /> : null}
      </NavInternalsContext.Provider>
    </NavApiContext.Provider>
  );
}
