import { FocusGroup, Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { LETTERS } from './browse';

export const ALPHA_KEY_PREFIX = 'alpha:';

/**
 * The letters at the right edge of Browse: "#" and A to Z. A letter without titles is dimmed and
 * cannot take the focus, so Up and Down pass over it (`available` is undefined while the server
 * has not said, and then every letter can be used). OK on a letter shows only its titles; OK on
 * the chosen letter shows them all again.
 */
export function AlphabetRail({
  available,
  selected,
  numbersEnabled,
  onPick,
}: {
  available: ReadonlySet<string> | undefined;
  selected: string | null;
  /** "#" is a title-prefix rule that needs the extended rules; without them it is dimmed. */
  numbersEnabled: boolean;
  onPick: (letter: string) => void;
}) {
  const t = useT();
  const reachable = (letter: string) =>
    (letter !== '#' || numbersEnabled) && (!available || available.has(letter));
  const first = LETTERS.find(reachable);
  const preferred = selected ?? first;
  return (
    <FocusGroup
      focusKey="alpha-rail"
      enterable
      saveLastFocusedChild={false}
      preferredChildFocusKey={preferred ? `${ALPHA_KEY_PREFIX}${preferred}` : undefined}
      className="alpha-rail"
      role="toolbar"
      aria-label={t('library.rail.label')}
      data-testid="alpha-rail"
    >
      {LETTERS.map((letter) => {
        // The chosen letter stays usable, so it can always be switched off again.
        const usable = reachable(letter) || letter === selected;
        return (
          <Focusable
            key={letter}
            focusKey={`${ALPHA_KEY_PREFIX}${letter}`}
            className={`alpha-letter${letter === selected ? ' selected' : ''}${usable ? '' : ' dim'}`}
            disabled={!usable}
            aria-pressed={letter === selected}
            aria-label={t('library.rail.letter', { letter })}
            data-letter={letter}
            onClick={() => onPick(letter)}
          >
            {letter}
          </Focusable>
        );
      })}
    </FocusGroup>
  );
}
