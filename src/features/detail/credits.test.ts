import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '../../i18n';
import { itemDetail } from '../../test/detailFixtures';
import { CAST_ROW_LIMIT, STRIP_CAST_LIMIT, castCrewStrip, castRow, crewBoxRows } from './credits';
import type { ItemDetail } from './info';

const en = (key: MessageKey) => translate('en', key);
const de = (key: MessageKey) => translate('de', key);

type Crew = ItemDetail['crew'][number];
type Cast = ItemDetail['cast'][number];
const crew = (name: string, job: string, id?: string): Crew => ({
  name,
  job,
  ...(id ? { person_id: id } : {}),
});
const cast = (name: string, order: number, character = `As ${name}`, id?: string): Cast => ({
  name,
  order,
  character,
  ...(id ? { person_id: id } : {}),
});
const detail = (overrides: Partial<ItemDetail>) => itemDetail(overrides);

/** The names of a strip with their subtitles and dividers, flattened for a compact comparison. */
const shape = (entries: ReturnType<typeof castCrewStrip>) =>
  entries.map((e) => `${e.divider ? `[${e.divider}] ` : ''}${e.name} / ${e.subtitle}`);

describe('castCrewStrip: the lead group', () => {
  it('leads a movie with up to two directors, subtitled Director', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director', 'd2'),
          crew('Dir Three', 'Director', 'd3'),
        ],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Dir One / Director', 'Dir Two / Director']);
  });

  it('leads a series with every creator, subtitled Creator, and ignores its directors', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Cre One', 'Creator', 'c1'),
          crew('Cre Two', 'Creator', 'c2'),
          crew('Cre Three', 'Creator', 'c3'),
          crew('Dir One', 'Director', 'd1'),
        ],
      }),
      true,
      en,
    );
    expect(shape(strip)).toEqual(['Cre One / Creator', 'Cre Two / Creator', 'Cre Three / Creator']);
  });

  it('falls back to up to two directors for a series without a creator', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director', 'd2'),
          crew('Dir Three', 'Director', 'd3'),
        ],
      }),
      true,
      en,
    );
    expect(shape(strip)).toEqual(['Dir One / Director', 'Dir Two / Director']);
  });

  it('does not lead a movie with its creators', () => {
    const strip = castCrewStrip(detail({ crew: [crew('Cre One', 'Creator', 'c1')] }), false, en);
    expect(strip).toEqual([]);
  });

  it('shows a person who directs twice once', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Dir One', 'Director', 'd1'),
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director', 'd2'),
        ],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Dir One / Director', 'Dir Two / Director']);
  });

  it('words the subtitles in German', () => {
    const strip = castCrewStrip(
      detail({
        crew: [crew('Cre', 'Creator', 'c'), crew('Wri', 'Writer', 'w')],
      }),
      true,
      de,
    );
    expect(shape(strip)).toEqual(['Cre / Idee', '[Drehbuch] Wri / Drehbuch']);
  });
});

describe('castCrewStrip: the writers', () => {
  it('takes up to three writers, jobs Writer or Screenplay, subtitled Writer', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Wri One', 'Writer', 'w1'),
          crew('Wri Two', 'Screenplay', 'w2'),
          crew('Wri Three', 'writer', 'w3'),
          crew('Wri Four', 'Writer', 'w4'),
          crew('Producer', 'Producer', 'p1'),
        ],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Wri One / Writer', 'Wri Two / Writer', 'Wri Three / Writer']);
  });

  it("counts a writer-director once: the card is the director's", () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Both', 'Director', 'b'),
          crew('Both', 'Writer', 'b'),
          crew('Wri', 'Writer', 'w'),
        ],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Both / Director', '[Writers] Wri / Writer']);
  });

  it('recognises the writer-director by name when the credits carry no person id', () => {
    const strip = castCrewStrip(
      detail({ crew: [crew('Both', 'Director'), crew('Both', 'Screenplay')] }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Both / Director']);
  });

  it('keeps a third director, who has no card of the lead group, as a writer', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director', 'd2'),
          crew('Dir Three', 'Director', 'd3'),
          crew('Dir Three', 'Writer', 'd3'),
        ],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual([
      'Dir One / Director',
      'Dir Two / Director',
      '[Writers] Dir Three / Writer',
    ]);
  });

  it('shows a writer who is also a creator of a series once, as the creator', () => {
    const strip = castCrewStrip(
      detail({ crew: [crew('Both', 'Creator', 'b'), crew('Both', 'Writer', 'b')] }),
      true,
      en,
    );
    expect(shape(strip)).toEqual(['Both / Creator']);
  });

  it('lists a writer of both jobs once', () => {
    const strip = castCrewStrip(
      detail({ crew: [crew('Wri', 'Writer', 'w'), crew('Wri', 'Screenplay', 'w')] }),
      false,
      en,
    );
    expect(shape(strip)).toEqual(['Wri / Writer']);
  });
});

describe('castCrewStrip: the cast and the dividers', () => {
  it('takes the first twelve cast members by billing order, subtitled with the character', () => {
    const people = Array.from({ length: STRIP_CAST_LIMIT + 4 }, (_, i) =>
      cast(`Actor ${i}`, i, `Role ${i}`),
    ).reverse();
    const strip = castCrewStrip(detail({ cast: people }), false, en);
    expect(strip).toHaveLength(12);
    expect(strip[0]).toMatchObject({ name: 'Actor 0', subtitle: 'Role 0' });
    expect(strip[11]).toMatchObject({ name: 'Actor 11', subtitle: 'Role 11' });
  });

  it('draws a divider before the writers and before the cast, none before the first group', () => {
    const strip = castCrewStrip(
      detail({
        crew: [crew('Dir', 'Director', 'd'), crew('Wri', 'Writer', 'w')],
        cast: [cast('Ann', 0, 'Ada'), cast('Bo', 1, 'Bea')],
      }),
      false,
      en,
    );
    expect(shape(strip)).toEqual([
      'Dir / Director',
      '[Writers] Wri / Writer',
      '[Cast] Ann / Ada',
      'Bo / Bea',
    ]);
  });

  it('words the dividers in German', () => {
    const strip = castCrewStrip(
      detail({
        crew: [crew('Dir', 'Director', 'd'), crew('Wri', 'Writer', 'w')],
        cast: [cast('Ann', 0, 'Ada')],
      }),
      false,
      de,
    );
    expect(strip.map((e) => e.divider)).toEqual([undefined, 'Drehbuch', 'Besetzung']);
  });

  it('draws no divider before a group that is empty, nor one at the start', () => {
    // No directors, no writers: the cast is the first group and has no label.
    expect(shape(castCrewStrip(detail({ cast: [cast('Ann', 0, 'Ada')] }), false, en))).toEqual([
      'Ann / Ada',
    ]);
    // Directors and cast, no writers: one divider, for the cast.
    expect(
      shape(
        castCrewStrip(
          detail({ crew: [crew('Dir', 'Director', 'd')], cast: [cast('Ann', 0, 'Ada')] }),
          false,
          en,
        ),
      ),
    ).toEqual(['Dir / Director', '[Cast] Ann / Ada']);
    // Writers first when nobody directs: no divider before them.
    expect(
      shape(
        castCrewStrip(
          detail({ crew: [crew('Wri', 'Writer', 'w')], cast: [cast('Ann', 0, 'Ada')] }),
          false,
          en,
        ),
      ),
    ).toEqual(['Wri / Writer', '[Cast] Ann / Ada']);
  });

  it('is empty without crew and cast', () => {
    expect(castCrewStrip(detail({}), false, en)).toEqual([]);
    expect(castCrewStrip(detail({}), true, en)).toEqual([]);
  });

  it('gives a person who directs and acts a card in each group, with different keys', () => {
    const strip = castCrewStrip(
      detail({
        crew: [crew('Both', 'Director', 'b')],
        cast: [cast('Both', 0, 'Himself', 'b')],
      }),
      false,
      en,
    );
    expect(strip).toHaveLength(2);
    expect(new Set(strip.map((e) => e.key)).size).toBe(2);
  });

  it('carries the person, the photo and the thumbhash of a card', () => {
    const strip = castCrewStrip(
      detail({
        crew: [
          {
            name: 'Dir',
            job: 'Director',
            person_id: 'd',
            photo_url: '/p/d',
            photo_thumbhash: 'th',
          },
        ],
        cast: [{ name: 'Ann', order: 0, character: 'Ada', photo_url: '/p/a' }],
      }),
      false,
      en,
    );
    expect(strip[0]).toMatchObject({ personId: 'd', photo: '/p/d', thumbhash: 'th' });
    expect(strip[1]).toMatchObject({ personId: undefined, photo: '/p/a', thumbhash: undefined });
  });
});

describe('castRow', () => {
  it('takes the first twenty by billing order and no crew', () => {
    const people = Array.from({ length: CAST_ROW_LIMIT + 5 }, (_, i) =>
      cast(`Actor ${i}`, i),
    ).reverse();
    const row = castRow(detail({ cast: people, crew: [crew('Dir', 'Director', 'd')] }));
    expect(row).toHaveLength(20);
    expect(row[0]!.name).toBe('Actor 0');
    expect(row[19]!.name).toBe('Actor 19');
    expect(row.every((e) => e.divider === undefined)).toBe(true);
    expect(row.some((e) => e.name === 'Dir')).toBe(false);
  });

  it('subtitles a card with the character', () => {
    expect(castRow(detail({ cast: [cast('Ann', 0, 'Ada')] }))[0]).toMatchObject({
      name: 'Ann',
      subtitle: 'Ada',
    });
  });

  it('is empty without cast', () => {
    expect(castRow(detail({}))).toEqual([]);
  });
});

describe('crewBoxRows', () => {
  it('lists Director, Writer and Producer in that order, each only with credits', () => {
    const rows = crewBoxRows(
      detail({
        crew: [
          crew('Pro', 'Producer', 'p'),
          crew('Wri', 'Writer', 'w'),
          crew('Dir', 'Director', 'd'),
        ],
      }),
    );
    expect(rows.map((r) => [r.job, r.label, r.names.map((n) => n.name)])).toEqual([
      ['director', 'detail.crewRow.directors', ['Dir']],
      ['writer', 'detail.crewRow.writers', ['Wri']],
      ['producer', 'detail.crewRow.producers', ['Pro']],
    ]);
  });

  it('leaves a row out when it has no credits', () => {
    const rows = crewBoxRows(detail({ crew: [crew('Pro', 'Producer', 'p')] }));
    expect(rows.map((r) => r.job)).toEqual(['producer']);
  });

  it('does not count Screenplay as Writer, nor any other job', () => {
    const rows = crewBoxRows(
      detail({
        crew: [
          crew('Screen', 'Screenplay', 's'),
          crew('Cam', 'Director of Photography', 'c'),
          crew('Cre', 'Creator', 'k'),
        ],
      }),
    );
    expect(rows).toEqual([]);
  });

  it('lists a person once per row, in credit order, also by name without an id', () => {
    const rows = crewBoxRows(
      detail({
        crew: [
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director'),
          crew('Dir One', 'Director', 'd1'),
          crew('Dir Two', 'Director'),
        ],
      }),
    );
    expect(rows[0]!.names.map((n) => n.name)).toEqual(['Dir One', 'Dir Two']);
  });

  it('lists a person in every row of a job they hold', () => {
    const rows = crewBoxRows(
      detail({ crew: [crew('Both', 'Director', 'b'), crew('Both', 'Writer', 'b')] }),
    );
    expect(rows.map((r) => r.names.map((n) => n.name))).toEqual([['Both'], ['Both']]);
  });

  it('carries the person id, none for a credit without one', () => {
    const rows = crewBoxRows(
      detail({ crew: [crew('Known', 'Director', 'k1'), crew('Unknown', 'Director')] }),
    );
    expect(rows[0]!.names.map((n) => n.personId)).toEqual(['k1', undefined]);
  });

  it('is empty without crew', () => {
    expect(crewBoxRows(detail({}))).toEqual([]);
  });
});

describe('credits: padded jobs and the identity of a person', () => {
  it('reads a job with padding or another case as the job (strip and crew box)', () => {
    const padded = detail({
      crew: [
        crew('Dir', ' Director ', 'd'),
        crew('Wri', ' Writer ', 'w'),
        crew('Pro', ' Producer ', 'p'),
      ],
    });
    expect(shape(castCrewStrip(padded, false, en))).toEqual([
      'Dir / Director',
      '[Writers] Wri / Writer',
    ]);
    expect(crewBoxRows(padded).map((r) => [r.job, r.names.map((n) => n.name)])).toEqual([
      ['director', ['Dir']],
      ['writer', ['Wri']],
      ['producer', ['Pro']],
    ]);
  });

  it('shows the same person without ids once, however the name is padded', () => {
    const jane = detail({ crew: [crew('Jane ', 'Director'), crew('Jane', 'Director')] });
    expect(crewBoxRows(jane)[0]!.names).toHaveLength(1);
    expect(castCrewStrip(jane, false, en)).toHaveLength(1);
  });

  it('keeps two people of the same name and different ids apart, with different keys', () => {
    const twins = detail({
      crew: [crew('Sam Same', 'Director', 's1'), crew('Sam Same', 'Director', 's2')],
    });
    const strip = castCrewStrip(twins, false, en);
    expect(strip).toHaveLength(2);
    expect(new Set(strip.map((e) => e.key)).size).toBe(2);
    const names = crewBoxRows(twins)[0]!.names;
    expect(names).toHaveLength(2);
    expect(new Set(names.map((n) => n.key)).size).toBe(2);
  });
});
