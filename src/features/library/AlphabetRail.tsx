import { FocusGroup, Focusable, moveFocusTo } from '../../app/nav';
import { useT } from '../../i18n';
import { LETTERS } from './browse';

export const ALPHA_KEY_PREFIX = 'alpha:';

/**
 * The jump marks at the right edge of a title-ordered Browse: "#" and A to Z. A letter without
 * titles is dimmed and cannot take the focus, so Up and Down pass over it. OK on a letter jumps
 * the grid to its first title and leaves the focus on the rail; Left goes into the grid, to the
 * card `gridEntry` names. The active letter is the one the grid shows at its top.
 */
export function AlphabetRail({
  lit,
  active,
  gridEntry,
  onJump,
}: {
  lit: ReadonlySet<string>;
  /** The letter of the grid's top row. */
  active: string | undefined;
  /** The focus key of the card Left enters the grid on; undefined leaves Left to the spatial search. */
  gridEntry: () => string | undefined;
  onJump: (letter: string) => void;
}) {
  const t = useT();
  const preferred =
    active !== undefined && lit.has(active) ? active : LETTERS.find((l) => lit.has(l));
  return (
    <FocusGroup
      focusKey="alpha-rail"
      enterable
      saveLastFocusedChild={false}
      preferredChildFocusKey={preferred ? `${ALPHA_KEY_PREFIX}${preferred}` : undefined}
      onArrow={(direction) => {
        const entry = direction === 'left' ? gridEntry() : undefined;
        return entry === undefined ? false : moveFocusTo(entry);
      }}
      className="alpha-rail"
      role="toolbar"
      aria-label={t('library.rail.label')}
      data-testid="alpha-rail"
    >
      {LETTERS.map((letter) => {
        const usable = lit.has(letter);
        return (
          <Focusable
            key={letter}
            focusKey={`${ALPHA_KEY_PREFIX}${letter}`}
            className={`alpha-letter${letter === active ? ' active' : ''}${usable ? '' : ' dim'}`}
            disabled={!usable}
            aria-current={letter === active ? 'true' : undefined}
            aria-label={t('library.rail.letter', { letter })}
            data-letter={letter}
            onClick={() => onJump(letter)}
          >
            {letter}
          </Focusable>
        );
      })}
    </FocusGroup>
  );
}
