import { useEffect, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';
import { SORT_KEYS, SORT_LABELS, type SortKey } from './browse';

export const DIALOG_KEY_PREFIX = 'lib-dialog-';
const sortKey = (sort: SortKey) => `${DIALOG_KEY_PREFIX}sort-${sort}`;

/**
 * The list of sorts over Browse. The current one is marked with its direction; choosing it again
 * reverses it, choosing another one starts that sort in its usual direction. The focus is trapped
 * in the list, and it returns to the pill that opened it.
 */
export function SortList({
  sort,
  descending,
  onChoose,
}: {
  sort: SortKey;
  descending: boolean;
  onChoose: (sort: SortKey) => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());

  useEffect(() => {
    void setFocus(sortKey(sort));
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
    // The focus goes to the current sort when the list opens, not after every choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="lib-sort-list"
        boundary
        autoRestoreFocus={false}
        className="lib-panel"
        role="menu"
        aria-label={t('library.sort.heading')}
        data-testid="sort-list"
      >
        <p className="lib-panel-heading">{t('library.sort.heading')}</p>
        {SORT_KEYS.map((key) => {
          const current = key === sort;
          return (
            <Focusable
              key={key}
              focusKey={sortKey(key)}
              role="menuitemradio"
              aria-checked={current}
              className="menu-item menu-item-split"
              onClick={() => onChoose(key)}
            >
              <span>{t(SORT_LABELS[key])}</span>
              <span className="menu-value" data-testid={current ? 'sort-current' : undefined}>
                {current
                  ? `${descending ? '↓' : '↑'} ${t(descending ? 'library.sort.descending' : 'library.sort.ascending')}`
                  : ''}
              </span>
            </Focusable>
          );
        })}
      </FocusGroup>
    </div>
  );
}
