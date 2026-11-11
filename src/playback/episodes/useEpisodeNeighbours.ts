import { useMemo } from 'react';
import { useSeasonEpisodes, useSeasons } from '../../features/detail/queries';
import {
  NO_NEIGHBOURS,
  neighbourList,
  neighboursOf,
  nextSeasonNumber,
  type Neighbours,
} from './neighbours';

/**
 * The previous and next episode of an episode that plays. It reads the series' seasons (to learn
 * whether the next season exists), the current season's episodes and the next season's: the
 * catalog's `/series/{id}/seasons` and `/series/{id}/seasons/{num}/episodes`, the reads the detail
 * page makes, so their cache is shared. Until they arrive there are no neighbours.
 */
export function useEpisodeNeighbours(
  seriesId: string | undefined,
  seasonNumber: number,
  episodeNumber: number,
): Neighbours {
  const id = seriesId ?? '';
  const seasons = useSeasons(id, id !== '');
  const next = seasons.data ? nextSeasonNumber(seasons.data, seasonNumber) : undefined;
  const current = useSeasonEpisodes(id, id !== '' ? seasonNumber : undefined);
  const following = useSeasonEpisodes(id, next);
  const currentItems = current.data;
  const followingItems = following.data;
  // Next may need the next season's list: until the reads have answered (or failed) the answer
  // would be wrong at a season's last episode (none, then appearing).
  const settled =
    (seasons.isSuccess || seasons.isError) &&
    (next === undefined || following.isSuccess || following.isError);
  return useMemo(() => {
    if (!currentItems || !settled) return NO_NEIGHBOURS;
    return neighboursOf(neighbourList(currentItems, followingItems), seasonNumber, episodeNumber);
  }, [currentItems, followingItems, settled, seasonNumber, episodeNumber]);
}
