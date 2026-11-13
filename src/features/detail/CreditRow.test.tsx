import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithSilo } from '../../test/renderFlow';
import { FocusIndexMemory } from '../../ui/media';
import { CreditRow } from './CreditRow';
import type { CreditEntry } from './credits';

const entry = (key: string, divider?: string): CreditEntry => ({
  key,
  name: `Person ${key}`,
  personId: key,
  photo: undefined,
  thumbhash: undefined,
  subtitle: 'Actor',
  divider,
});

describe('CreditRow', () => {
  it('puts the cards 225 px apart (185 + 40): the gap holds the divider label of a group', () => {
    renderWithSilo(
      <CreditRow
        rowId="cast"
        title="Cast & Crew"
        entries={[entry('a'), entry('b', 'Cast')]}
        memory={new FocusIndexMemory()}
        onRowFocused={() => undefined}
        onOpenPerson={() => undefined}
      />,
    );
    const slots = screen.getByTestId('row-cast').querySelectorAll<HTMLElement>('.row-slot');
    expect(slots[1]!.style.left).toBe('225px');
  });

  it('names the row by its rowId, so the cast row and the crew row of a page are apart', () => {
    renderWithSilo(
      <CreditRow
        rowId="crew"
        title="Crew"
        entries={[entry('a')]}
        memory={new FocusIndexMemory()}
        onRowFocused={() => undefined}
        onOpenPerson={() => undefined}
      />,
    );
    expect(screen.getByTestId('row-crew')).toBeInTheDocument();
    expect(screen.queryByTestId('row-cast')).toBeNull();
  });
});
