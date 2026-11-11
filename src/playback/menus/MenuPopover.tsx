import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  focusFromPointer,
  moveFocusTo,
  SelfFocusing,
  setFocus,
  type ArrowHandler,
  type FocusableProps,
} from '../../app/nav';

/**
 * Takes the focus when it mounts, on the row the viewer was on before the stream reloaded (when it
 * is still there), else on the menu's own first choice. It sits after the rows, so their effects
 * (which register them with the navigation) have run.
 *
 * The focus is set one task later. The navigation handles a key press asynchronously and runs a
 * focus change ahead of it, so the OK that opened the menu would otherwise land on the row that
 * takes the focus and press it.
 */
function FocusOnMount({
  recall,
  fallback,
  onReady,
}: {
  recall(): string | null;
  fallback: string;
  onReady(): void;
}) {
  useEffect(() => {
    // Read now, not in the timeout: the navigation gives the focus back to a row whose key it
    // still holds from the menu that was open before (the same keys), and that row would then be
    // remembered as the viewer's choice.
    const remembered = recall();
    const timer = setTimeout(() => {
      onReady();
      void setFocus(remembered && doesFocusableExist(remembered) ? remembered : fallback);
    }, 0);
    return () => clearTimeout(timer);
    // Once per mount: the menu claims the focus when it opens (or opens again after a reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

interface RowApi {
  /** A row got the focus: remember it and keep it in view. */
  focused(key: string): void;
  /**
   * The menu has taken its own focus. Until then a press on a row is the one that opened the menu
   * (the navigation holds the focus key of a row of an earlier menu and gives it back on mount),
   * and it must not act.
   */
  ready(): boolean;
}
const RowContext = createContext<RowApi | null>(null);

/** A button of a menu that takes part in the navigation; `base` is the look it starts from. */
function MenuButton({
  base,
  focusKey,
  onFocused,
  onClick,
  className,
  ...rest
}: FocusableProps & { base: string }) {
  const api = useContext(RowContext);
  return (
    <Focusable
      focusKey={focusKey}
      className={`${base}${className ? ` ${className}` : ''}`}
      onFocused={() => {
        api?.focused(focusKey);
        onFocused?.();
      }}
      onClick={(event) => {
        if (api && !api.ready()) return;
        onClick?.(event);
      }}
      {...rest}
    />
  );
}

/** One row of a menu: a full-width button. */
export function MenuRow(props: FocusableProps) {
  return <MenuButton base="menu-item menu-item-split player-menu-row" {...props} />;
}

/** One of several buttons that share a row (the subtitle delay's minus, plus and reset). */
export function MenuControl(props: FocusableProps) {
  return <MenuButton base="player-menu-control" {...props} />;
}

export interface MenuPopoverProps {
  label: string;
  testId: string;
  /**
   * The focus keys of the rows, top to bottom. A row of several buttons is a non-empty list of
   * their keys, left to right: Left and Right walk it, Up and Down enter it on its first key.
   */
  rows: readonly (string | readonly [string, ...string[]])[];
  /** The row that takes the focus when the menu opens fresh (the checked or current one). */
  fallback: string;
  /** The remembered focus: noted on every row focus, recalled after a reload of the stream. */
  remember(key: string): void;
  recall(): string | null;
  /** Left or Right: the menu closes and the focus moves to the neighbouring button. */
  onSide(direction: 'left' | 'right'): void;
  children: ReactNode;
}

/**
 * A menu as a popover above its button. Up and Down walk the rows by index and hold at the ends;
 * Left and Right leave the menu. A long list scrolls inside the popover and the focused row is
 * kept in view. Back and the media keys are the player's (usePlayerControls).
 */
export function MenuPopover({
  label,
  testId,
  rows,
  fallback,
  remember,
  recall,
  onSide,
  children,
}: MenuPopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const markReady = useCallback(() => void (readyRef.current = true), []);

  const api = useMemo<RowApi>(
    () => ({
      ready: () => readyRef.current,
      focused(key) {
        remember(key);
        // The pointer never scrolls (origin.ts); a key press does, and nothing animates.
        if (focusFromPointer()) return;
        const row = Array.from(box.current?.querySelectorAll('[data-focus-key]') ?? []).find(
          (el) => el.getAttribute('data-focus-key') === key,
        );
        row?.scrollIntoView?.({ block: 'nearest' });
      },
    }),
    [remember],
  );

  // Index navigation: the rows know where each one is, so no spatial search runs.
  const onArrow: ArrowHandler = (direction, fromKey) => {
    const at = rows.findIndex((row) =>
      typeof row === 'string' ? row === fromKey : row.includes(fromKey),
    );
    const row = rows[at];
    if (direction === 'left' || direction === 'right') {
      // Inside a row of buttons the press moves to the neighbour; past its end it leaves the menu.
      const next =
        row === undefined || typeof row === 'string'
          ? undefined
          : row[row.indexOf(fromKey) + (direction === 'right' ? 1 : -1)];
      if (next !== undefined) return moveFocusTo(next);
      onSide(direction);
      return true;
    }
    const target = rows[at + (direction === 'down' ? 1 : -1)];
    if (at < 0 || target === undefined) return true;
    return moveFocusTo(typeof target === 'string' ? target : target[0]);
  };

  return (
    <SelfFocusing>
      <RowContext.Provider value={api}>
        <FocusGroup
          focusKey={`player-menu-${testId}`}
          boundary
          autoRestoreFocus={false}
          className="player-menu"
          role="dialog"
          aria-label={label}
          data-testid={`player-menu-${testId}`}
          onArrow={onArrow}
        >
          <div className="player-menu-scroll" ref={box}>
            {children}
          </div>
          <FocusOnMount recall={recall} fallback={fallback} onReady={markReady} />
        </FocusGroup>
      </RowContext.Provider>
    </SelfFocusing>
  );
}
