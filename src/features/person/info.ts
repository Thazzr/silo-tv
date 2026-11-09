// What the person page says about a person, as pure functions: the dates, the age and the count.
import type { components } from '../../api/generated/schema';
import type { Language, MessageKey } from '../../i18n';

export type Person = components['schemas']['Person'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** "YYYY-MM-DD" as numbers; anything else (a partial or impossible date) is unknown. */
export function parseDate(iso: string | undefined): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso?.trim() ?? '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Round trip through UTC: 2020-02-31 is not a date.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * The date in long form in the app language ("8. Januar 1935", "January 8, 1935"); null when the
 * server sent none. Text that is not a date is shown as sent rather than dropped.
 */
export function formatDate(iso: string | undefined, lang: Language): string | null {
  const date = parseDate(iso);
  if (!date) return iso?.trim() || null;
  // UTC on both sides: a calendar date has no time zone, and local time could shift the day.
  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

/**
 * Whole years from `birth` to `until`; the birthday counts once it has been reached. Null when
 * the birth date is unknown or lies after `until`.
 */
export function ageOn(birth: string | undefined, until: CalendarDate): number | null {
  const born = parseDate(birth);
  if (!born) return null;
  let age = until.year - born.year;
  if (until.month < born.month || (until.month === born.month && until.day < born.day)) age -= 1;
  return age >= 0 ? age : null;
}

/** Today's calendar date in local time. */
export function today(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * The badge line under the name, in order and only what is known: the birth date, then either
 * the death date (with the age reached) or the age today, then the birthplace.
 */
export function personFacts(
  person: Person,
  lang: Language,
  t: Translate,
  now: Date = new Date(),
): string[] {
  const facts: string[] = [];
  const born = formatDate(person.birth_date, lang);
  if (born) facts.push(t('person.born', { date: born }));
  const died = formatDate(person.death_date, lang);
  if (died) {
    const death = parseDate(person.death_date)!;
    const age = ageOn(person.birth_date, death);
    facts.push(
      age === null ? t('person.diedNoAge', { date: died }) : t('person.died', { date: died, age }),
    );
  } else if (born) {
    const age = ageOn(person.birth_date, today(now));
    if (age !== null) facts.push(t('person.age', { age }));
  }
  const place = person.birthplace?.trim();
  if (place) facts.push(place);
  return facts;
}

/**
 * "57 titles" or "1 title"; "40+ titles" when the server gives no exact total, then `count` is
 * what has been loaded so far and more remain.
 */
export function countLabel(count: number, exact: boolean, t: Translate): string {
  if (!exact) return t('person.countMore', { count });
  return count === 1 ? t('person.countOne') : t('person.count', { count });
}

/** What the filmography grid lists: "video" is movies and series together. */
export type PersonFilter = 'all' | 'movie' | 'series';
export const FILTER_TYPE: Record<PersonFilter, string> = {
  all: 'video',
  movie: 'movie',
  series: 'series',
};
