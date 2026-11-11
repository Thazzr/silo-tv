// The pure rules that find the previous and next episode of the one that plays, as Silo's web
// player does. The module is also the base for Up Next, which wants the same "next" answer.
import type { components } from '../../api/generated/schema';

type Episode = components['schemas']['Episode'];

/** The part of a catalog episode the neighbour rules read. */
export type NeighbourEpisode = Pick<
  Episode,
  'content_id' | 'season_number' | 'episode_number' | 'title'
> & { files?: readonly { unreadable?: boolean }[] };

/** An episode the player can switch to. */
export interface EpisodeRef {
  contentId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
}

export interface Neighbours {
  previous: EpisodeRef | null;
  next: EpisodeRef | null;
}

export const NO_NEIGHBOURS: Neighbours = { previous: null, next: null };

/**
 * The season Next may cross into: the one numbered right after the current one, when the series
 * lists it. Season 0 (specials) is a season like any other, so its successor is season 1.
 */
export function nextSeasonNumber(
  seasons: readonly { season_number: number }[],
  current: number,
): number | undefined {
  return seasons.find((s) => s.season_number === current + 1)?.season_number;
}

/**
 * An episode whose files are all unreadable cannot play, so Previous and Next step over it. One
 * that lists no files at all stays: the list may leave them out, and the server decides on play.
 */
export function isPlayable(episode: NeighbourEpisode): boolean {
  const files = episode.files ?? [];
  return files.length === 0 || files.some((f) => f.unreadable !== true);
}

const toRef = (e: NeighbourEpisode): EpisodeRef => ({
  contentId: e.content_id,
  seasonNumber: e.season_number,
  episodeNumber: e.episode_number,
  title: e.title,
});

/**
 * The episodes the neighbours are picked from: the current season's, then the next season's
 * (when it exists), in the order the server lists them, playable ones only. The previous season
 * is never part of it, so Previous stops at the first episode of the current season.
 */
export function neighbourList(
  current: readonly NeighbourEpisode[],
  next: readonly NeighbourEpisode[] = [],
): EpisodeRef[] {
  return [...current, ...next].filter(isPlayable).map(toRef);
}

/** The entries before and after the episode with these numbers; none when it is not in the list. */
export function neighboursOf(
  list: readonly EpisodeRef[],
  seasonNumber: number,
  episodeNumber: number,
): Neighbours {
  const index = list.findIndex(
    (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber,
  );
  if (index < 0) return NO_NEIGHBOURS;
  return { previous: list[index - 1] ?? null, next: list[index + 1] ?? null };
}
