import type { KeyboardEvent } from 'react';
import { getPlatform } from '../../platform';

/**
 * The key handler of a card that the remote's Play key plays: OK opens the card's page, Play starts
 * what the card stands for. Every other key goes on to the navigation.
 */
export function onPlayKey(play: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (getPlatform().mapKey(event.nativeEvent) !== 'play') return;
    event.preventDefault();
    play();
  };
}
