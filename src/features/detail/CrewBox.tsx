import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { FocusGroup, Focusable, moveFocusTo, type ArrowHandler } from '../../app/nav';
import { useT } from '../../i18n';
import type { PersonTarget } from '../person/personMemory';
import type { CrewBoxRow, CrewJob } from './credits';
import { SectionHead } from './SectionHead';

export const CREW_BOX_KEY = 'crew';
export const crewNameFocusKey = (job: CrewJob, key: string) => `crew:${job}:${key}`;

/** Room kept between the focused name and the edge of its row when the row scrolls. */
const EDGE = 24;

/**
 * How far a row of names is scrolled so that the span `start`..`end` (of the focused name, in the
 * row's own coordinates) is in view: the current scroll when it already is, else the least change
 * that brings it in with `EDGE` to spare.
 */
export function revealScroll(scroll: number, start: number, end: number, width: number): number {
  if (start < scroll + EDGE) return Math.max(0, start - EDGE);
  if (end > scroll + width - EDGE) return end - width + EDGE;
  return scroll;
}

/**
 * The "Crew" box of a season or an episode: a row per job with its names, each a button that opens
 * the person's page (a name without a person id is plain text). Left and Right walk a row, Up and
 * Down move between the rows; a row that is wider than the box scrolls by a transform, so the
 * focused name is always in view.
 */
export const CrewBox = memo(function CrewBox({
  rows,
  onFocused,
  onOpenPerson,
}: {
  rows: readonly CrewBoxRow[];
  /** Any name got the focus (the page scrolls to this section). */
  onFocused: () => void;
  onOpenPerson: (target: PersonTarget) => void;
}) {
  const t = useT();
  // How far each row is scrolled, by job.
  const [scrolls, setScrolls] = useState<Partial<Record<CrewJob, number>>>({});

  // The focusable names of each row, in order: the arrow handler walks these.
  const stops = useMemo(
    () =>
      rows.map((row) =>
        row.names
          .filter((name) => name.personId)
          .map((name) => crewNameFocusKey(row.job, name.key)),
      ),
    [rows],
  );
  const firstStop = stops.find((row) => row.length > 0)?.[0];

  const arrow = useCallback<ArrowHandler>(
    (direction, fromKey) => {
      const at = stops.findIndex((row) => row.includes(fromKey));
      const row = stops[at];
      // Narrowing only: every name that can take the focus is in `stops`, so `at` is never -1.
      if (row === undefined) return false;
      const column = row.indexOf(fromKey);
      if (direction === 'left' || direction === 'right') {
        // The ends of a row stop the press: the search would jump to a name of another row.
        const target = row[column + (direction === 'right' ? 1 : -1)];
        return target === undefined ? true : moveFocusTo(target);
      }
      const step = direction === 'down' ? 1 : -1;
      for (let next = at + step; next >= 0 && next < stops.length; next += step) {
        const names = stops[next]!;
        if (names.length > 0) return moveFocusTo(names[Math.min(column, names.length - 1)]!);
      }
      // Past the first or last row: the page's own navigation takes over.
      return false;
    },
    [stops],
  );

  const trackEls = useRef<Partial<Record<CrewJob, HTMLElement | null>>>({});
  const revealName = (job: CrewJob, focusKey: string) => {
    const track = trackEls.current[job];
    const viewport = track?.parentElement;
    const name = Array.from(track?.children ?? []).find(
      (el) => el.getAttribute('data-focus-key') === focusKey,
    ) as HTMLElement | undefined;
    if (!viewport || !name) return;
    setScrolls((old) => {
      const next = revealScroll(
        old[job] ?? 0,
        name.offsetLeft,
        name.offsetLeft + name.offsetWidth,
        viewport.clientWidth,
      );
      return next === (old[job] ?? 0) ? old : { ...old, [job]: next };
    });
  };

  return (
    <section className="detail-crew" data-testid="detail-crew">
      <SectionHead title={t('detail.crew')} testId="crew-head" />
      <FocusGroup
        focusKey={CREW_BOX_KEY}
        enterable={firstStop !== undefined}
        // Entering again lands on the name last used (the library keeps it by default).
        preferredChildFocusKey={firstStop}
        onArrow={arrow}
        className="crew-box"
        data-testid="crew-box"
        data-transform-scrolled="box"
      >
        {rows.map((row) => (
          <div
            key={row.job}
            className="crew-row"
            data-testid={`crew-row-${row.job}`}
            role="group"
            aria-label={t(row.label)}
          >
            <span className="crew-label">{t(row.label)}</span>
            <div className="crew-names">
              <div
                className="crew-track"
                ref={(el) => {
                  trackEls.current[row.job] = el;
                }}
                style={{ transform: `translateX(${-(scrolls[row.job] ?? 0)}px)` }}
              >
                {row.names.map((name, index) => {
                  const focusKey = crewNameFocusKey(row.job, name.key);
                  const personId = name.personId;
                  return (
                    <Fragment key={name.key}>
                      {index > 0 ? (
                        <span className="crew-sep" aria-hidden="true">
                          ,
                        </span>
                      ) : null}
                      {personId ? (
                        <Focusable
                          focusKey={focusKey}
                          className="crew-name"
                          data-testid="crew-name"
                          onFocused={() => {
                            onFocused();
                            revealName(row.job, focusKey);
                          }}
                          onClick={() => onOpenPerson({ personId, personName: name.name })}
                        >
                          {name.name}
                        </Focusable>
                      ) : (
                        <span className="crew-name crew-name-plain" data-testid="crew-name-plain">
                          {name.name}
                        </span>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </FocusGroup>
    </section>
  );
});
