export type RemoteKey =
  | 'left'
  | 'up'
  | 'right'
  | 'down'
  | 'enter'
  | 'back'
  | 'play'
  | 'pause'
  | 'playPause'
  | 'stop'
  | 'rewind'
  | 'fastForward'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue';

const KEY_CODES: Readonly<Record<number, RemoteKey>> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'enter',
  // webOS sends 461 for Back; Escape and Backspace are the browser equivalents.
  461: 'back',
  27: 'back',
  8: 'back',
  415: 'play',
  19: 'pause',
  179: 'playPause',
  413: 'stop',
  412: 'rewind',
  417: 'fastForward',
  403: 'red',
  404: 'green',
  405: 'yellow',
  406: 'blue',
};

export function mapKey(e: KeyboardEvent): RemoteKey | null {
  return KEY_CODES[e.keyCode] ?? null;
}
