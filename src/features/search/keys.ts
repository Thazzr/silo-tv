// The layout and the movement of the on-screen keyboard, as pure functions. The keyboard is a
// grid of seven columns; the last row has three wide keys.
import type { ArrowDirection } from '../../app/nav';
import type { MessageKey } from '../../i18n';
import { MAX_QUERY_LENGTH } from './info';

export const KEYBOARD_COLUMNS = 7;

export type KeyKind = 'char' | 'space' | 'delete' | 'clear';

export interface KeySpec {
  /** The character itself, or `space`, `delete`, `clear`. */
  id: string;
  kind: KeyKind;
  /** The first of the columns the key covers. */
  col: number;
  span: number;
  row: number;
  /** The words on a wide key; a character key shows its character. */
  label?: MessageKey;
}

const CHAR_ROWS = ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyzäö', 'üß12345', "67890-'"];

export const KEY_ROWS: KeySpec[][] = [
  ...CHAR_ROWS.map((chars, row) =>
    [...chars].map((id, col): KeySpec => ({ id, kind: 'char', col, span: 1, row })),
  ),
  [
    { id: 'space', kind: 'space', col: 0, span: 3, row: 6, label: 'search.key.space' },
    { id: 'delete', kind: 'delete', col: 3, span: 2, row: 6, label: 'search.key.delete' },
    { id: 'clear', kind: 'clear', col: 5, span: 2, row: 6, label: 'search.key.clear' },
  ],
];

export const KEYS: readonly KeySpec[] = KEY_ROWS.flat();
const byId = new Map(KEYS.map((key) => [key.id, key]));

export const KEY_PREFIX = 'osk:';
export const keyFocusKey = (id: string): string => `${KEY_PREFIX}${id}`;

/** The key a focus key belongs to, or null for any other element. */
export function keyOfFocusKey(focusKey: string): KeySpec | null {
  return focusKey.startsWith(KEY_PREFIX)
    ? (byId.get(focusKey.slice(KEY_PREFIX.length)) ?? null)
    : null;
}

/** What the text becomes when a key is pressed: no leading or double space, never past 200 characters. */
export function applyKey(text: string, key: KeySpec): string {
  switch (key.kind) {
    case 'char':
      return text.length >= MAX_QUERY_LENGTH ? text : text + key.id;
    case 'space':
      return text === '' || text.endsWith(' ') || text.length >= MAX_QUERY_LENGTH
        ? text
        : `${text} `;
    case 'delete':
      return text.slice(0, -1);
    case 'clear':
      return '';
  }
}

export type KeyMove =
  /** The focus goes to this key. */
  | { to: KeySpec }
  /** Right from the last key of a row: on to the results. */
  | { out: true }
  /** Up from the first row: the top bar's business. */
  | { up: true }
  /** The edge: nothing happens. */
  | { stay: true };

/**
 * Where an arrow press leads from a key. Left and Right walk along the row; Up and Down go to the
 * key of the neighbouring row that covers the first column of the one pressed.
 */
export function moveOnKeyboard(direction: ArrowDirection, from: KeySpec): KeyMove {
  const row = KEY_ROWS[from.row]!;
  const at = row.indexOf(from);
  if (direction === 'left') return at > 0 ? { to: row[at - 1]! } : { stay: true };
  if (direction === 'right') return at < row.length - 1 ? { to: row[at + 1]! } : { out: true };
  const next = KEY_ROWS[from.row + (direction === 'down' ? 1 : -1)];
  if (!next) return direction === 'up' ? { up: true } : { stay: true };
  const target = next.find((key) => from.col >= key.col && from.col < key.col + key.span);
  return target ? { to: target } : { stay: true };
}
