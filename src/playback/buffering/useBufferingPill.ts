import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PROMPT_MS } from '../session/bufferingQuality';
import type { BufferingAnswer, BufferingOffer } from '../session/BufferingManager';

export type BufferingChoice = 'lower' | 'keep';

interface Args {
  offer: BufferingOffer | null;
  /** The corner is free: the skip pill wins the slot, the buffering pill waits for it. */
  slotFree: boolean;
  /** The viewer paused: the countdown freezes. */
  paused: boolean;
  answer(answer: BufferingAnswer): void;
  shown(id: number): void;
}

export interface BufferingPillControl {
  /** The pill is on screen now. */
  visible: boolean;
  /** The countdown is running (visible and not paused). */
  running: boolean;
  /** Milliseconds of the countdown already used, so a pill that waited resumes its line where it was. */
  elapsedMs: number;
  /** The button the focus is on, for the prompt. */
  choice: BufferingChoice;
  setChoice(choice: BufferingChoice): void;
  /** OK on the pill: the focused button's action. */
  activate(): void;
  /** Back: "Keep quality" on the prompt, hides the undo pill. */
  dismiss(): void;
  /** Left or Right between the prompt's two buttons; false when there is nowhere to go. */
  move(direction: 'left' | 'right'): boolean;
  lower(): void;
  keep(): void;
  restore(): void;
}

/**
 * The 15 s countdown of the buffering prompt or undo pill, and its two buttons' focus. The
 * countdown starts when the pill shows, waits while the skip pill holds the corner and freezes
 * while playback is paused.
 */
export function useBufferingPill(args: Args): BufferingPillControl {
  const { offer, slotFree, paused } = args;
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });
  const [choice, setChoice] = useState<BufferingChoice>('lower');
  const choiceRef = useRef<BufferingChoice>('lower');
  useEffect(() => {
    choiceRef.current = choice;
  });
  const left = useRef(PROMPT_MS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const id = offer?.id ?? null;
  // The offer now on screen; a layout effect, so it is current when the old offer's timer is cleaned up.
  const currentId = useRef(id);
  useLayoutEffect(() => {
    currentId.current = id;
  });
  const visible = offer !== null && slotFree;
  const running = visible && !paused;

  // A new offer starts with its whole countdown and the primary button (derived while rendering,
  // so its first frame already shows it).
  const [lastId, setLastId] = useState<number | null>(null);
  if (id !== lastId) {
    setLastId(id);
    setElapsedMs(0);
    setChoice('lower');
  }
  useEffect(() => {
    left.current = PROMPT_MS;
    choiceRef.current = 'lower';
  }, [id]);

  useEffect(() => {
    if (id === null || !running) return undefined;
    const startedAt = Date.now();
    const timer = setTimeout(() => latest.current.answer('expire'), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - startedAt));
      // A timer that ends because a new offer came must not hand its elapsed time to the new one.
      if (currentId.current === id) setElapsedMs(PROMPT_MS - left.current);
    };
  }, [id, running]);

  useEffect(() => {
    if (id !== null && visible) latest.current.shown(id);
  }, [id, visible]);

  const lower = useCallback(() => latest.current.answer('lower'), []);
  const keep = useCallback(() => latest.current.answer('keep'), []);
  const restore = useCallback(() => latest.current.answer('restore'), []);
  const activate = useCallback(() => {
    if (latest.current.offer?.kind === 'undo') restore();
    else if (choiceRef.current === 'keep') keep();
    else lower();
  }, [restore, keep, lower]);
  const dismiss = useCallback(() => {
    latest.current.answer(latest.current.offer?.kind === 'undo' ? 'hide' : 'keep');
  }, []);
  const move = useCallback((direction: 'left' | 'right') => {
    if (latest.current.offer?.kind !== 'prompt') return false;
    const target: BufferingChoice = direction === 'right' ? 'keep' : 'lower';
    if (choiceRef.current === target) return false;
    choiceRef.current = target;
    setChoice(target);
    return true;
  }, []);

  return {
    visible,
    running,
    elapsedMs,
    choice,
    setChoice,
    activate,
    dismiss,
    move,
    lower,
    keep,
    restore,
  };
}
