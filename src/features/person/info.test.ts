import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n';
import { ageOn, countLabel, formatDate, parseDate, personFacts } from './info';
import { personOf } from '../../test/personFixtures';

const en = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('en', key, params);
const de = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('de', key, params);

describe('parseDate', () => {
  it('reads YYYY-MM-DD and nothing else', () => {
    expect(parseDate('1940-04-25')).toEqual({ year: 1940, month: 4, day: 25 });
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('1940')).toBeNull();
    expect(parseDate('1940-04')).toBeNull();
    expect(parseDate('25.04.1940')).toBeNull();
  });

  it('rejects a date that does not exist', () => {
    expect(parseDate('2021-02-31')).toBeNull();
    expect(parseDate('2021-13-01')).toBeNull();
    expect(parseDate('2020-02-29')).not.toBeNull();
  });
});

describe('formatDate', () => {
  it('writes the date in long form in the app language', () => {
    expect(formatDate('1940-04-25', 'en')).toBe('April 25, 1940');
    expect(formatDate('1940-04-25', 'de')).toBe('25. April 1940');
  });

  it('does not shift the day with the machine time zone', () => {
    expect(formatDate('2004-07-01', 'en')).toBe('July 1, 2004');
    expect(formatDate('2004-12-31', 'en')).toBe('December 31, 2004');
  });

  it('is null without a date, and shows text that is not a date as sent', () => {
    expect(formatDate(undefined, 'en')).toBeNull();
    expect(formatDate('  ', 'en')).toBeNull();
    expect(formatDate('around 1940', 'en')).toBe('around 1940');
  });
});

describe('ageOn', () => {
  const on = (year: number, month: number, day: number) => ({ year, month, day });

  it('counts the birthday once it has been reached', () => {
    expect(ageOn('1940-04-25', on(2026, 4, 25))).toBe(86);
    expect(ageOn('1940-04-25', on(2026, 4, 26))).toBe(86);
    expect(ageOn('1940-04-25', on(2026, 12, 31))).toBe(86);
  });

  it('counts one less while the birthday is still to come this year', () => {
    expect(ageOn('1940-04-25', on(2026, 4, 24))).toBe(85);
    expect(ageOn('1940-04-25', on(2026, 1, 1))).toBe(85);
    expect(ageOn('1940-12-31', on(2026, 12, 30))).toBe(85);
  });

  it('is null without a usable birth date, or when it lies after the end', () => {
    expect(ageOn(undefined, on(2026, 1, 1))).toBeNull();
    expect(ageOn('nonsense', on(2026, 1, 1))).toBeNull();
    expect(ageOn('2030-01-01', on(2026, 1, 1))).toBeNull();
  });
});

describe('personFacts', () => {
  const now = new Date(2026, 3, 24); // April 24, 2026: the birthday of April 25 is not reached

  it('lists birth, age today and birthplace, in that order', () => {
    expect(personFacts(personOf(), 'en', en, now)).toEqual([
      'Born April 25, 1940',
      '85 years old',
      'Springfield, USA',
    ]);
  });

  it('writes it in German, too', () => {
    expect(personFacts(personOf(), 'de', de, now)).toEqual([
      'Geboren am 25. April 1940',
      '85 Jahre alt',
      'Springfield, USA',
    ]);
  });

  it('gives the age reached at death instead of the age today', () => {
    const facts = personFacts(
      personOf({ birth_date: '1940-04-25', death_date: '2004-04-24' }),
      'en',
      en,
      now,
    );
    expect(facts).toEqual([
      'Born April 25, 1940',
      'Died April 24, 2004 (age 63)',
      'Springfield, USA',
    ]);
    expect(personFacts(personOf({ death_date: '2004-04-25' }), 'de', de, now)[1]).toBe(
      'Gestorben am 25. April 2004 (64 Jahre)',
    );
  });

  it('leaves out what is not known', () => {
    expect(
      personFacts(personOf({ birth_date: undefined, birthplace: undefined }), 'en', en, now),
    ).toEqual([]);
    expect(personFacts(personOf({ birthplace: '  ' }), 'en', en, now)).toEqual([
      'Born April 25, 1940',
      '85 years old',
    ]);
    // A death date without a birth date names no age.
    expect(
      personFacts(personOf({ birth_date: undefined, death_date: '2004-07-01' }), 'en', en, now),
    ).toEqual(['Died July 1, 2004', 'Springfield, USA']);
  });
});

describe('countLabel', () => {
  it('counts exactly, with a singular', () => {
    expect(countLabel(57, true, en)).toBe('57 titles');
    expect(countLabel(1, true, en)).toBe('1 title');
    expect(countLabel(57, true, de)).toBe('57 Titel');
    expect(countLabel(1, true, de)).toBe('1 Titel');
  });

  it('adds a plus when the total is only a lower bound', () => {
    expect(countLabel(40, false, en)).toBe('40+ titles');
    expect(countLabel(40, false, de)).toBe('40+ Titel');
    expect(countLabel(1, false, en)).toBe('1+ titles');
  });
});
