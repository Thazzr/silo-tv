import { useCallback, useEffect, useRef, useState } from 'react';
import type { EpisodeRef } from '../episodes/neighbours';
import type { TimeRange } from './autoplayRegion';
import { isStillWatchingGated } from './stillWatching';
import { useCountdown } from './useCountdown';

/** Seconds the card counts down before the next episode starts by itself. */
export const UP_NEXT_SECONDS = 10;

export type UpNextChoice = 'play' | 'cancel';

interface Args {
  /** The card may show: the first frame has played, and no menu or end screen covers the corner. */
  enabled: boolean;
  /** Where the next episode may start by itself (the credits); null without one. */
  region: TimeRange | null;
  next: EpisodeRef | null;
  /** The reported position on the source timeline. */
  position: number;
  /** The viewer cancelled the card for this episode. */
  cancelled: boolean;
  cancel(): void;
  /** Starts the next episode: `automatic` when the countdown ran out, else the viewer asked. */
  start(automatic: boolean): void;
}

export interface UpNextCardControl {
  shown: boolean;
  /** Whole seconds left. */
  seconds: number;
  /** The focused button. */
  choice: UpNextChoice;
  setChoice(choice: UpNextChoice): void;
  /** OK on the card: the focused button's action. */
  activate(): void;
  /** Back: hides the card for the rest of the episode. False when it was not showing. */
  dismiss(): boolean;
  /** Left or Right between the two buttons; false when there is nowhere to go. */
  move(direction: 'left' | 'right'): boolean;
  playNow(): void;
  cancelCard(): void;
}

/**
 * The corner card of an episode's credits: while the playhead is inside the region, a next episode
 * exists, the viewer has not cancelled it and the still-watching gate is open, it counts down from
 * 10 and then starts the next episode by itself. It does not ask for the profile's auto-play
 * setting: the web's card does not either.
 */
export function useUpNextCard(args: Args): UpNextCardControl {
  const { enabled, region, next, position, cancelled } = args;
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });
  const inRegion = region !== null && position >= region.start && position < region.end;
  const shown = enabled && inRegion && next !== null && !cancelled && !isStillWatchingGated();

  const seconds = useCountdown(shown, UP_NEXT_SECONDS, () => latest.current.start(true));

  const [choice, setChoice] = useState<UpNextChoice>('play');
  const choiceRef = useRef<UpNextChoice>('play');
  useEffect(() => {
    choiceRef.current = choice;
  });
  // A card that appears starts on the primary button (derived while rendering, so its first
  // frame already shows it).
  const [lastShown, setLastShown] = useState(false);
  if (shown !== lastShown) {
    setLastShown(shown);
    setChoice('play');
  }

  const playNow = useCallback(() => latest.current.start(false), []);
  const cancelCard = useCallback(() => latest.current.cancel(), []);
  const activate = useCallback(() => {
    if (choiceRef.current === 'cancel') latest.current.cancel();
    else latest.current.start(false);
  }, []);
  const dismiss = useCallback(() => {
    if (!shown) return false;
    latest.current.cancel();
    return true;
  }, [shown]);
  const move = useCallback((direction: 'left' | 'right') => {
    const target: UpNextChoice = direction === 'right' ? 'cancel' : 'play';
    if (choiceRef.current === target) return false;
    choiceRef.current = target;
    setChoice(target);
    return true;
  }, []);

  return { shown, seconds, choice, setChoice, activate, dismiss, move, playNow, cancelCard };
}
