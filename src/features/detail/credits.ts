// The people on a detail page, as pure functions: the "Cast & Crew" strip of a movie or series, the
// "Cast" row and the "Crew" row of a season or episode. The rules are the web's (castCrewGroups,
// CrewList): who leads, who is left out because another card already shows them, how many cards.
// Only the form of the season and episode crew differs: cards, not the web's text box.
import type { MessageKey } from '../../i18n';
import type { ItemDetail } from './info';

type Translate = (key: MessageKey) => string;
type Cast = ItemDetail['cast'][number];
type Crew = ItemDetail['crew'][number];

/** The strip shows the first cast members by billing order. */
export const STRIP_CAST_LIMIT = 12;
/** The "Cast" row of a season or episode shows this many people. */
export const CAST_ROW_LIMIT = 20;
/** A movie's directors in the lead group, and any lead group that falls back to directors. */
const LEAD_DIRECTORS_MAX = 2;
const WRITERS_MAX = 3;

/** One card of the strip or of the cast or crew row. */
export interface CreditEntry {
  /** Unique in the row: a person can be a director and an actor of one title. */
  key: string;
  name: string;
  personId: string | undefined;
  photo: string | undefined;
  thumbhash: string | undefined;
  /**
   * The role (Director, Writer, ...) or, for a cast member, the character. In the crew row, all of
   * the person's jobs among the three, joined with ", ".
   */
  subtitle: string;
  /** The label of the divider drawn before this card: set on the first card of every later group. */
  divider: string | undefined;
}

const job = (person: Crew) => person.job.trim().toLowerCase();
/** Who a credit is: the person's id, else the name, so one person is one card. */
const personKey = (person: { person_id?: string; name: string }) =>
  person.person_id || person.name.trim();

function uniquePeople(people: readonly Crew[]): Crew[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    const key = personKey(person);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function crewCard(person: Crew, group: string, subtitle: string): Omit<CreditEntry, 'divider'> {
  return {
    key: `${group}:${personKey(person)}`,
    name: person.name,
    personId: person.person_id,
    photo: person.photo_url,
    thumbhash: person.photo_thumbhash,
    subtitle,
  };
}

function castCard(person: Cast, group: string): Omit<CreditEntry, 'divider'> {
  return {
    key: `${group}:${person.person_id ?? `${person.order}-${person.name}`}`,
    name: person.name,
    personId: person.person_id,
    photo: person.photo_url,
    thumbhash: person.photo_thumbhash,
    subtitle: person.character,
  };
}

const byBilling = (cast: readonly Cast[]) => [...cast].sort((a, b) => a.order - b.order);

/**
 * The "Cast & Crew" strip of a movie or a series: the lead group (a movie's directors, two at most;
 * a series' creators, else its directors), the writers (three at most, anyone the lead group shows
 * left out) and the first cast members. Every group after the first starts with a divider label;
 * an empty group has neither cards nor label.
 */
export function castCrewStrip(detail: ItemDetail, series: boolean, t: Translate): CreditEntry[] {
  const creators = series ? uniquePeople(detail.crew.filter((p) => job(p) === 'creator')) : [];
  const lead =
    creators.length > 0
      ? { role: 'detail.role.creator' as const, people: creators }
      : {
          role: 'detail.role.director' as const,
          people: uniquePeople(detail.crew.filter((p) => job(p) === 'director')).slice(
            0,
            LEAD_DIRECTORS_MAX,
          ),
        };
  // Only the lead cards on show count: a third director still shows as a writer.
  const shown = new Set(lead.people.map(personKey));
  const writers = uniquePeople(
    detail.crew.filter(
      (p) => (job(p) === 'writer' || job(p) === 'screenplay') && !shown.has(personKey(p)),
    ),
  ).slice(0, WRITERS_MAX);
  const cast = byBilling(detail.cast).slice(0, STRIP_CAST_LIMIT);

  const groups = [
    { label: '', cards: lead.people.map((p) => crewCard(p, 'lead', t(lead.role))) },
    {
      label: t('detail.crewRow.writers'),
      cards: writers.map((p) => crewCard(p, 'writer', t('detail.role.writer'))),
    },
    { label: t('detail.cast'), cards: cast.map((p) => castCard(p, 'cast')) },
  ].filter((group) => group.cards.length > 0);
  return groups.flatMap((group, index) =>
    group.cards.map((card, i) => ({
      ...card,
      divider: index > 0 && i === 0 ? group.label : undefined,
    })),
  );
}

/** The "Cast" row of a season or an episode: the first cast members by billing order, no crew. */
export function castRow(detail: ItemDetail): CreditEntry[] {
  return byBilling(detail.cast)
    .slice(0, CAST_ROW_LIMIT)
    .map((person) => ({ ...castCard(person, 'cast'), divider: undefined }));
}

/** The jobs of the "Crew" row, in its order. `Screenplay` is not a writer here. */
const CREW_JOBS = [
  { job: 'director', role: 'detail.role.director', divider: undefined },
  { job: 'writer', role: 'detail.role.writer', divider: 'detail.crewRow.writers' },
  { job: 'producer', role: 'detail.role.producer', divider: 'detail.crewRow.producers' },
] as const satisfies readonly {
  job: string;
  role: MessageKey;
  divider: MessageKey | undefined;
}[];

/**
 * The "Crew" row of a season or an episode: directors, writers and producers as cards like the
 * cast's, no other job. A person is one card, in the group of their first job, and the subtitle
 * lists all their jobs. Within a group people keep their credit order, and every group after the
 * first non-empty one starts with a divider label.
 */
export function crewRow(detail: ItemDetail, t: Translate): CreditEntry[] {
  const listed = detail.crew.filter((p) => CREW_JOBS.some((wanted) => wanted.job === job(p)));
  const cards = uniquePeople(listed).map((person) => {
    const jobs = CREW_JOBS.filter((wanted) =>
      listed.some((p) => personKey(p) === personKey(person) && job(p) === wanted.job),
    );
    // A listed person has at least one of the three jobs.
    const first = jobs[0]!;
    return {
      first,
      card: crewCard(person, 'crew', jobs.map((wanted) => t(wanted.role)).join(', ')),
    };
  });
  // The sort is stable: people keep their credit order inside a group.
  cards.sort((a, b) => CREW_JOBS.indexOf(a.first) - CREW_JOBS.indexOf(b.first));
  return cards.map(({ first, card }, index) => ({
    ...card,
    divider:
      // `first.divider` is narrowing only: directors sort first, so a later group always has its key.
      index > 0 && cards[index - 1]!.first !== first && first.divider
        ? t(first.divider)
        : undefined,
  }));
}
