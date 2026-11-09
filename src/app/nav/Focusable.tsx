import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { ArrowContext, type ArrowDirection } from './arrows';
import { FrameContext } from './ScreenFrame';
import { getCurrentFocusKey, setFocus, setFocusFromPointer } from './init';

/**
 * Lets a container hear which element got the focus, whatever the element is (a tab, a card in a
 * list a feature owns). The shell uses it for the tab switch delay and for per-tab focus memory.
 */
export const FocusTrackerContext = createContext<((focusKey: string) => void) | null>(null);

interface ItemOptions {
  /** Must be stable across renders and screen visits: focus memory finds the element by it. */
  focusKey: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Called when this element receives the focus (arrow keys, setFocus or the pointer). */
  onFocused?: () => void;
}

/**
 * Joins one element to the spatial navigation: OK clicks it, the Magic Remote pointer and DOM
 * focus move the shared focus state to it, so 5-way keys continue from wherever the pointer is.
 */
function useNavItem<E extends HTMLElement>({
  focusKey,
  autoFocus,
  disabled,
  onFocused,
}: ItemOptions) {
  const frame = useContext(FrameContext);
  const tracker = useContext(FocusTrackerContext);
  const arrow = useContext(ArrowContext);
  const arrowRef = useRef(arrow);
  const click = useRef<() => void>(() => undefined);
  const focused = useRef<() => void>(() => undefined);
  const { ref } = useFocusable<unknown, E>({
    focusKey,
    focusable: !disabled,
    onEnterPress: () => click.current(),
    // False keeps the library from searching when a group above decided the press (arrows.ts).
    onArrowPress: (direction) => arrowRef.current?.(direction as ArrowDirection, focusKey) !== true,
    onFocus: () => focused.current(),
  });

  useEffect(() => {
    arrowRef.current = arrow;
    click.current = () => ref.current?.click();
    focused.current = () => {
      tracker?.(focusKey);
      onFocused?.();
    };
  });

  // Registered after useFocusable's own effect, so the element is known to the service here.
  useEffect(() => {
    const wantsFocus = Boolean(autoFocus) && !disabled;
    if (frame) frame.onMounted(focusKey, wantsFocus);
    else if (wantsFocus) void setFocus(focusKey);
    return () => frame?.onUnmounted(focusKey);
    // Once per mount: focus is claimed when the element appears, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusHere = (fromPointer: boolean) => () => {
    if (disabled || getCurrentFocusKey() === focusKey) return;
    void (fromPointer ? setFocusFromPointer(focusKey) : setFocus(focusKey));
  };
  // Hover moves the focus but never scrolls (see origin.ts). onFocus covers DOM focus that did
  // not come from the service (touch, a script).
  return { ref, handlers: { onMouseEnter: focusHere(true), onFocus: focusHere(false) } };
}

export interface FocusableProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'autoFocus' | 'onMouseEnter' | 'onFocus'>,
    ItemOptions {}

/** A button that takes part in 5-way navigation. */
export function Focusable({
  focusKey,
  autoFocus,
  disabled,
  onFocused,
  type,
  ...rest
}: FocusableProps) {
  const { ref, handlers } = useNavItem<HTMLButtonElement>({
    focusKey,
    autoFocus,
    disabled,
    onFocused,
  });
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled}
      data-focus-key={focusKey}
      {...handlers}
      {...rest}
    />
  );
}

export interface FocusableInputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, 'autoFocus' | 'onMouseEnter' | 'onFocus'>,
    ItemOptions {}

/** A text field that takes part in 5-way navigation; Left, Right and Enter stay with the field. */
export function FocusableInput({
  focusKey,
  autoFocus,
  disabled,
  onFocused,
  ...rest
}: FocusableInputProps) {
  const { ref, handlers } = useNavItem<HTMLInputElement>({
    focusKey,
    autoFocus,
    disabled,
    onFocused,
  });
  return <input ref={ref} disabled={disabled} data-focus-key={focusKey} {...handlers} {...rest} />;
}
