import { useEffect, useRef, useState } from 'react';
import {
  Focusable,
  FocusGroup,
  doesFocusableExist,
  getCurrentFocusKey,
  setFocus,
} from '../../app/nav';
import { useT } from '../../i18n';
import {
  DECADES,
  FACET_LABELS,
  FACETS,
  facetNeedsExtendedRules,
  filterCount,
  isSingleChoice,
  STATUS_LABELS,
  STATUS_VALUES,
  type Facet,
  type FilterSelection,
  type StatusValue,
} from './browse';
import { useOverlayBack } from './OverlayBack';
import { DIALOG_KEY_PREFIX } from './SortList';
import type { CatalogFilters } from './queries';

const facetKey = (facet: Facet) => `${DIALOG_KEY_PREFIX}facet-${facet}`;
const valueKey = (facet: Facet, value: string) => `${DIALOG_KEY_PREFIX}value-${facet}-${value}`;
const CLEAR_KEY = `${DIALOG_KEY_PREFIX}clear`;
const DONE_KEY = `${DIALOG_KEY_PREFIX}done`;
const ALL_KEY = `${DIALOG_KEY_PREFIX}all`;
/** The "All" row of a single-choice facet: no choice. */
const NO_CHOICE_KEY = (facet: Facet) => `${DIALOG_KEY_PREFIX}value-${facet}-none`;

/** The values the server lists for each facet; the decades are the app's own. */
export function facetValues(facet: Facet, filters: CatalogFilters | undefined): string[] {
  switch (facet) {
    case 'genre':
      return filters?.genres ?? [];
    case 'decade':
      return [...DECADES];
    case 'status':
      return [...STATUS_VALUES];
    case 'content_rating':
      return filters?.content_ratings ?? [];
  }
}

/**
 * Takes the focus when it mounts. It sits after the rows it points at, so their effects (which
 * register them with the navigation) have run: a plain effect of the panel would be too early.
 */
function FocusOnMount({ focusKey, onDone }: { focusKey: string; onDone: () => void }) {
  useEffect(() => {
    void setFocus(focusKey);
    onDone();
    // Once per mount: the focus is claimed when the view changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * The filter panel over Browse. It edits a copy: Done, or Back from the list of facets, applies
 * it. A facet opens its values as checkboxes ; Back, or the
 * "All filters" row, returns to the list on that facet. A facet the server lists no values for is
 * left out.
 */
export function FilterPanel({
  filters,
  facets,
  loading,
  extended,
  watchRules,
  onApply,
}: {
  filters: FilterSelection;
  /** The server's facet values; undefined while they load or when they could not be read. */
  facets: CatalogFilters | undefined;
  loading: boolean;
  /** The server accepts the extended rules; without them the decade is not offered. */
  extended: boolean;
  /** The server accepts the watch-state rules; without them the Status section is not offered. */
  watchRules: boolean;
  onApply: (filters: FilterSelection) => void;
}) {
  const t = useT();
  const [previous] = useState(() => getCurrentFocusKey());
  const [draft, setDraft] = useState<FilterSelection>(filters);
  // The facet whose values are shown; null shows the list of facets.
  const [open, setOpen] = useState<Facet | null>(null);
  // Where the focus goes after the view changed.
  const [landing, setLanding] = useState<string | null>(null);

  const visible = FACETS.filter(
    (facet) =>
      (extended || !facetNeedsExtendedRules(facet)) &&
      (watchRules || facet !== 'status') &&
      facetValues(facet, facets).length > 0,
  );

  const firstKey = visible[0] ? facetKey(visible[0]) : DONE_KEY;
  // The row the panel put the focus on itself; null once the viewer or a facet view took over.
  const landedOn = useRef<string | null>(null);

  useEffect(() => {
    landedOn.current = firstKey;
    void setFocus(firstKey);
    return () => {
      if (previous && doesFocusableExist(previous)) void setFocus(previous);
    };
    // The focus goes to the first row when the panel opens, not whenever the facets arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server's facets can arrive after the panel opened (slow link or TV): the panel first
  // landed on the only row there was ("Done", or Status). When the real first row shows up and the
  // focus is still where the panel put it, the focus follows to it; once the viewer moved, it stays.
  useEffect(() => {
    if (open !== null) landedOn.current = null;
    if (landedOn.current === null || landedOn.current === firstKey) return;
    if (getCurrentFocusKey() !== landedOn.current) {
      landedOn.current = null;
      return;
    }
    landedOn.current = firstKey;
    void setFocus(firstKey);
  }, [firstKey, open]);

  const apply = () => onApply(draft);
  const closeFacet = (facet: Facet) => {
    setOpen(null);
    setLanding(facetKey(facet));
  };

  useOverlayBack(() => {
    if (open) {
      closeFacet(open);
      return true;
    }
    apply();
    return true;
  });

  const toggle = (facet: Facet, value: string) => {
    const current = draft[facet] ?? [];
    let next: string[];
    if (current.includes(value)) next = current.filter((v) => v !== value);
    else next = isSingleChoice(facet) ? [value] : [...current, value];
    setDraft({ ...draft, [facet]: next });
  };

  const labelOf = (facet: Facet, value: string): string => {
    if (facet === 'decade') return t('library.decade', { decade: value });
    if (facet === 'status') return t(STATUS_LABELS[value as StatusValue]);
    return value;
  };

  const summary = (facet: Facet): string => {
    const values = draft[facet] ?? [];
    if (values.length === 0)
      return t(isSingleChoice(facet) ? 'library.filter.statusAll' : 'library.filter.any');
    if (values.length === 1) return labelOf(facet, values[0]!);
    return t('library.filter.selected', { count: values.length });
  };

  return (
    <div className="dialog-backdrop">
      <FocusGroup
        focusKey="lib-filter-panel"
        boundary
        autoRestoreFocus={false}
        className="lib-panel lib-panel-wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.filter.heading')}
        data-testid="filter-panel"
      >
        {open === null ? (
          <>
            <p className="lib-panel-heading">{t('library.filter.heading')}</p>
            {loading ? <p className="note">{t('library.filter.loading')}</p> : null}
            <div className="lib-panel-list">
              {visible.map((facet) => (
                <Focusable
                  key={facet}
                  focusKey={facetKey(facet)}
                  aria-haspopup="menu"
                  className="menu-item menu-item-split"
                  onClick={() => {
                    setOpen(facet);
                    setLanding(
                      isSingleChoice(facet)
                        ? NO_CHOICE_KEY(facet)
                        : valueKey(facet, facetValues(facet, facets)[0]!),
                    );
                  }}
                >
                  <span>{t(FACET_LABELS[facet])}</span>
                  <span className="menu-value" data-testid={`facet-summary-${facet}`}>
                    {summary(facet)} ›
                  </span>
                </Focusable>
              ))}
            </div>
            <Focusable
              focusKey={CLEAR_KEY}
              className="menu-item"
              disabled={filterCount(draft) === 0}
              onClick={() => {
                setDraft({});
                setLanding(DONE_KEY);
              }}
            >
              {t('library.filter.clear')}
            </Focusable>
            <Focusable focusKey={DONE_KEY} className="menu-item" onClick={apply}>
              {t('library.filter.done')}
            </Focusable>
          </>
        ) : (
          <>
            <p className="lib-panel-heading">{t(FACET_LABELS[open])}</p>
            <Focusable focusKey={ALL_KEY} className="menu-item" onClick={() => closeFacet(open)}>
              ‹ {t('library.filter.all')}
            </Focusable>
            <div className="lib-panel-list" data-testid="facet-values">
              {isSingleChoice(open) ? (
                <Focusable
                  focusKey={NO_CHOICE_KEY(open)}
                  role="menuitemradio"
                  aria-checked={(draft[open] ?? []).length === 0}
                  className="menu-item menu-item-split"
                  onClick={() => setDraft({ ...draft, [open]: [] })}
                >
                  <span>{t('library.filter.statusAll')}</span>
                  <span aria-hidden="true">{(draft[open] ?? []).length === 0 ? '✓' : ''}</span>
                </Focusable>
              ) : null}
              {facetValues(open, facets).map((value) => {
                const checked = draft[open]?.includes(value) === true;
                return (
                  <Focusable
                    key={value}
                    focusKey={valueKey(open, value)}
                    role={isSingleChoice(open) ? 'menuitemradio' : 'menuitemcheckbox'}
                    aria-checked={checked}
                    className="menu-item menu-item-split"
                    onClick={() => toggle(open, value)}
                  >
                    <span>{labelOf(open, value)}</span>
                    <span aria-hidden="true">{checked ? '✓' : ''}</span>
                  </Focusable>
                );
              })}
            </div>
          </>
        )}
        {landing ? <FocusOnMount focusKey={landing} onDone={() => setLanding(null)} /> : null}
      </FocusGroup>
    </div>
  );
}
