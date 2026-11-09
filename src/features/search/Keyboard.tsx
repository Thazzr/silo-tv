import { memo, useState } from 'react';
import { FocusGroup, Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { SEARCH_KEYBOARD_KEY } from './arrows';
import { KEYBOARD_COLUMNS, KEYS, keyFocusKey, type KeySpec } from './keys';

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" className="osk-icon">
    <path
      d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7zM12 9.5l5 5M17 9.5l-5 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface KeyProps {
  spec: KeySpec;
  /** Both handlers must be stable: the keys are skipped while the keyboard re-renders. */
  onPress: (spec: KeySpec) => void;
  onFocused: (spec: KeySpec) => void;
}

// One key. A focus move or a typed character redraws none of them: the highlight is CSS (:focus).
const Key = memo(function Key({ spec, onPress, onFocused }: KeyProps) {
  const t = useT();
  const words = spec.label ? t(spec.label) : null;
  return (
    <Focusable
      focusKey={keyFocusKey(spec.id)}
      className={`osk-key osk-key-${spec.kind}`}
      style={{ gridColumn: `span ${spec.span}` }}
      aria-label={words ?? spec.id}
      data-testid={`osk-${spec.id}`}
      onClick={() => onPress(spec)}
      onFocused={() => onFocused(spec)}
    >
      {spec.kind === 'delete' ? <BackspaceIcon /> : null}
      {words ?? spec.id}
    </Focusable>
  );
});

/**
 * The on-screen keyboard: seven columns of 75 px keys, then a row of Space, Delete and Clear.
 * Entering the group lands on the key last used (the first time on "a"). Keys only change on
 * focus or hover; typing never moves the focus.
 */
export const Keyboard = memo(function Keyboard({
  startKey,
  onPress,
  onFocused,
}: {
  /** The id of the key that gets the focus first; read once. */
  startKey: string;
  onPress: (spec: KeySpec) => void;
  onFocused: (spec: KeySpec) => void;
}) {
  const t = useT();
  const [first] = useState(() => keyFocusKey(startKey));
  return (
    <FocusGroup
      focusKey={SEARCH_KEYBOARD_KEY}
      enterable
      saveLastFocusedChild
      preferredChildFocusKey={first}
      className="osk"
      data-columns={KEYBOARD_COLUMNS}
      role="group"
      aria-label={t('search.keyboard')}
      data-testid="search-keyboard"
    >
      {KEYS.map((spec) => (
        <Key key={spec.id} spec={spec} onPress={onPress} onFocused={onFocused} />
      ))}
    </FocusGroup>
  );
});
