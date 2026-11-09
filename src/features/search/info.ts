// The pure rules of Search: what a query is, which scope each segment searches, and how the
// results are worded.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';
import { episodeLabel, isEpisode, type CatalogItem } from '../../ui/media';

type Capabilities = Pick<
  components['schemas']['CatalogSearchCapabilities'],
  'box_sets' | 'people_media_scope' | 'video_with_episodes_scope'
>;
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The longest query the app sends. */
export const MAX_QUERY_LENGTH = 200;
/** Typing has to rest this long before a search starts. */
export const SEARCH_DELAY_MS = 300;
/** Box sets above the titles, and people next to them: only the best matches. */
export const BOX_SET_LIMIT = 4;
export const PEOPLE_LIMIT = 12;

export const SEGMENTS = ['all', 'movies', 'series'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, MessageKey> = {
  all: 'search.segment.all',
  movies: 'search.segment.movies',
  series: 'search.segment.series',
};

/** What the server is sent: the typed text without the spaces around it, cut to 200 characters. */
export function normaliseQuery(text: string): string {
  return text.trim().slice(0, MAX_QUERY_LENGTH).trimEnd();
}

/**
 * The `type` of the titles search. "All" covers movies, series and episodes where the server can
 * (`video_with_episodes_scope`), else movies and series (`video`); an older server would ignore
 * the unknown scope and search books too.
 */
export function titleType(segment: Segment, capabilities: Capabilities | undefined): string {
  if (segment === 'movies') return 'movie';
  if (segment === 'series') return 'series';
  return capabilities?.video_with_episodes_scope === true ? 'video_with_episodes' : 'video';
}

/** The scope of the people search: the same one as the titles' "All". */
export function peopleScope(capabilities: Capabilities | undefined): string {
  return titleType('all', capabilities);
}

/** Box sets match movies, so they are offered for "All" and "Movies" on a server that has them. */
export function wantsBoxSets(segment: Segment, capabilities: Capabilities | undefined): boolean {
  return capabilities?.box_sets === true && (segment === 'all' || segment === 'movies');
}

/** People are offered for "All" only, and only where the server can scope and filter them. */
export function wantsPeople(segment: Segment, capabilities: Capabilities | undefined): boolean {
  return capabilities?.people_media_scope === true && segment === 'all';
}

/** "12 results", "1 result", or "40+ results" when the server only estimates. */
export function countLabel(total: number, exact: boolean, t: Translate): string {
  if (!exact) return t('search.countMore', { count: total });
  return total === 1 ? t('search.countOne') : t('search.count', { count: total });
}

/**
 * The second caption line of a result: the year of a title; for an episode "S1 · E2 · Title"
 * (its series is the first line), or just its title when the numbers are unknown.
 */
export function resultSubtitle(item: CatalogItem): string {
  if (!isEpisode(item)) return item.year ? String(item.year) : '';
  const label = episodeLabel(item);
  return label ? `${label} · ${item.title}` : item.title;
}
