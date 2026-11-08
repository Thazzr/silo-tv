import { describe, expect, it } from 'vitest';
import { mapKey, type RemoteKey } from './keys';

const cases: [number, RemoteKey][] = [
  [37, 'left'],
  [38, 'up'],
  [39, 'right'],
  [40, 'down'],
  [13, 'enter'],
  [461, 'back'],
  [27, 'back'],
  [8, 'back'],
  [415, 'play'],
  [19, 'pause'],
  [179, 'playPause'],
  [413, 'stop'],
  [412, 'rewind'],
  [417, 'fastForward'],
  [403, 'red'],
  [404, 'green'],
  [405, 'yellow'],
  [406, 'blue'],
];

describe('mapKey', () => {
  it.each(cases)('maps keyCode %i to %s', (keyCode, expected) => {
    expect(mapKey(new KeyboardEvent('keydown', { keyCode }))).toBe(expected);
  });

  it('returns null for an unknown keyCode', () => {
    expect(mapKey(new KeyboardEvent('keydown', { keyCode: 65 }))).toBeNull();
  });
});
