import { describe, expect, it } from 'vitest';
import {
  applyKey,
  KEY_ROWS,
  KEYBOARD_COLUMNS,
  keyFocusKey,
  keyOfFocusKey,
  KEYS,
  moveOnKeyboard,
  type KeySpec,
} from './keys';

const key = (id: string): KeySpec => KEYS.find((k) => k.id === id)!;
const at = (direction: 'left' | 'right' | 'up' | 'down', id: string) =>
  moveOnKeyboard(direction, key(id));

describe('the keyboard layout', () => {
  it('is six rows of seven keys and a row of Space (3), Delete (2) and Clear (2)', () => {
    expect(KEYBOARD_COLUMNS).toBe(7);
    expect(KEY_ROWS.map((row) => row.map((k) => k.id).join(''))).toEqual([
      'abcdefg',
      'hijklmn',
      'opqrstu',
      'vwxyzäö',
      'üß12345',
      "67890-'",
      'spacedeleteclear',
    ]);
    expect(KEY_ROWS[6]!.map((k) => k.span)).toEqual([3, 2, 2]);
    // Every row fills exactly the seven columns.
    for (const row of KEY_ROWS) expect(row.reduce((sum, k) => sum + k.span, 0)).toBe(7);
  });

  it('gives every key a focus key that leads back to it', () => {
    for (const k of KEYS) expect(keyOfFocusKey(keyFocusKey(k.id))).toBe(k);
    expect(keyOfFocusKey('search-pill:all')).toBeNull();
    expect(keyOfFocusKey('osk:nope')).toBeNull();
  });
});

describe('applyKey', () => {
  it('types a character, umlauts and digits included', () => {
    expect(applyKey('sa', key('g'))).toBe('sag');
    expect(applyKey('', key('ä'))).toBe('ä');
    expect(applyKey('ß', key('7'))).toBe('ß7');
  });

  it('deletes the last character, and nothing from an empty text', () => {
    expect(applyKey('sag', key('delete'))).toBe('sa');
    expect(applyKey('', key('delete'))).toBe('');
  });

  it('clears the text', () => {
    expect(applyKey('sagas', key('clear'))).toBe('');
  });

  it('types a space only between words', () => {
    expect(applyKey('star', key('space'))).toBe('star ');
    expect(applyKey('', key('space'))).toBe('');
    expect(applyKey('star ', key('space'))).toBe('star ');
  });

  it('stops at 200 characters', () => {
    const full = 'a'.repeat(200);
    expect(applyKey(full, key('b'))).toBe(full);
    expect(applyKey(full, key('space'))).toBe(full);
    expect(applyKey(full.slice(1), key('b'))).toBe(`${full.slice(1)}b`);
  });
});

describe('moveOnKeyboard', () => {
  it('walks along a row, and stays at its left edge', () => {
    expect(at('right', 'b')).toEqual({ to: key('c') });
    expect(at('left', 'b')).toEqual({ to: key('a') });
    expect(at('left', 'a')).toEqual({ stay: true });
    expect(at('left', 'h')).toEqual({ stay: true });
  });

  it('leaves the right edge of a row for the results', () => {
    expect(at('right', 'g')).toEqual({ out: true });
    expect(at('right', "'")).toEqual({ out: true });
    expect(at('right', 'clear')).toEqual({ out: true });
  });

  it('moves between the wide keys of the last row', () => {
    expect(at('right', 'space')).toEqual({ to: key('delete') });
    expect(at('right', 'delete')).toEqual({ to: key('clear') });
    expect(at('left', 'clear')).toEqual({ to: key('delete') });
  });

  it('moves up and down by the column the key starts in', () => {
    expect(at('down', 'a')).toEqual({ to: key('h') });
    expect(at('up', 'h')).toEqual({ to: key('a') });
    // Row 6 to the wide keys: columns 0-2 are Space, 3-4 Delete, 5-6 Clear.
    expect(at('down', '6')).toEqual({ to: key('space') });
    expect(at('down', '8')).toEqual({ to: key('space') });
    expect(at('down', '9')).toEqual({ to: key('delete') });
    expect(at('down', '-')).toEqual({ to: key('clear') });
    // And back up from their first column.
    expect(at('up', 'space')).toEqual({ to: key('6') });
    expect(at('up', 'delete')).toEqual({ to: key('9') });
    expect(at('up', 'clear')).toEqual({ to: key('-') });
  });

  it('hands Up from the first row to the tab bar and stops at the bottom', () => {
    expect(at('up', 'd')).toEqual({ up: true });
    expect(at('down', 'space')).toEqual({ stay: true });
  });
});
