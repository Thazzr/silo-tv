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
});
