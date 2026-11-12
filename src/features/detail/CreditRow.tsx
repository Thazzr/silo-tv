import { memo, useCallback } from 'react';
import { PersonCard, Row, type CardContext, type FocusIndexMemory } from '../../ui/media';
import type { PersonTarget } from '../person/personMemory';
import { type CreditEntry } from './credits';
import { initials } from './info';
import { DETAIL_INSET } from './layout';

const entryKey = (entry: CreditEntry) => entry.key;

/**
 * A row of people: the "Cast & Crew" strip of a movie or series (directors, writers, cast, with a
 * rotated label in the gap before each later group) or the "Cast" row of a season or an episode.
 * A card opens its person's page; a credit without a person id has none to open. The divider
 * belongs to the first card of its group, so it scrolls with the row and costs no card slot.
 */
export const CreditRow = memo(function CreditRow({
  title,
  entries,
  memory,
  onRowFocused,
  onOpenPerson,
}: {
  title: string;
  entries: readonly CreditEntry[];
  memory: FocusIndexMemory;
  /** Any card got the focus (the page scrolls to this row). */
  onRowFocused: () => void;
  onOpenPerson: (target: PersonTarget) => void;
}) {
  const renderCard = useCallback(
    (entry: CreditEntry, ctx: CardContext) => (
      <>
        {entry.divider === undefined ? null : (
          <span className="credit-divider" data-testid="credit-divider" aria-hidden="true">
            <span className="credit-divider-label">{entry.divider}</span>
          </span>
        )}
        <PersonCard
          name={entry.name}
          role={entry.subtitle}
          photo={entry.photo}
          thumbhash={entry.thumbhash}
          initials={initials(entry.name)}
          focusKey={ctx.focusKey}
          onFocused={ctx.onFocused}
          onOpen={() => {
            if (entry.personId) onOpenPerson({ personId: entry.personId, personName: entry.name });
          }}
        />
      </>
    ),
    [onOpenPerson],
  );
  return (
    <Row
      rowId="cast"
      title={title}
      shape="poster"
      items={entries}
      getKey={entryKey}
      memory={memory}
      inset={DETAIL_INSET}
      onRowFocused={onRowFocused}
      renderCard={renderCard}
    />
  );
});
