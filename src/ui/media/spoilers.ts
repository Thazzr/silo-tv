// Spoiler protection for unwatched episodes (settings `catalog.hide_unwatched_episode_images` and
// `catalog.hide_unwatched_episode_overviews`). The server never changes its answers for them; the
// client hides an episode's own still and description. Series and season artwork always shows.
import { useCallback, useMemo } from 'react';
import { useProfileSettings } from '../../features/settings/profileSettings';
import { isEpisode, landscapeArt, posterArt, type CatalogItem } from './cardInfo';
import { useMediaUrl } from './useMediaUrl';

export interface SpoilerSettings {
  images: boolean;
  overviews: boolean;
}

export const NO_SPOILER_PROTECTION: SpoilerSettings = { images: false, overviews: false };

/**
 * Both settings, live. They count as off until the server has answered, and when it cannot: the
 * registry default of both keys is off, which is what `useProfileSettings` returns until then.
 */
export function useSpoilerSettings(): SpoilerSettings {
  const { values } = useProfileSettings();
  const images = values['catalog.hide_unwatched_episode_images'];
  const overviews = values['catalog.hide_unwatched_episode_overviews'];
  return useMemo(() => ({ images, overviews }), [images, overviews]);
}

/** The watch data of an episode row. */
export interface EpisodeWatchData {
  user_data?: { played: boolean; is_in_progress?: boolean; position_seconds?: number };
}

/** An episode row is unwatched without watch data, or when it is neither played nor started. */
export function episodeRowUnwatched(episode: EpisodeWatchData): boolean {
  const data = episode.user_data;
  if (!data) return true;
  return !data.played && !data.is_in_progress && !((data.position_seconds ?? 0) > 0);
}

/** A card is unwatched unless it is marked played or has a saved position. */
export function cardUnwatched(item: CatalogItem): boolean {
  return item.user_state?.played !== true && !((item.position_seconds ?? 0) > 0);
}

/**
 * Whether the picture a card shows is the episode's own still. The server says so per picture
 * (`false` is other artwork); a missing answer counts as a still. A series or season picture
 * that the card falls back to is never one.
 */
export function cardShowsEpisodeStill(item: CatalogItem, shape: 'poster' | 'landscape'): boolean {
  if (!isEpisode(item)) return false;
  if (shape === 'poster') {
    const art = posterArt(item);
    if (!art.url) return false;
    if (item.series_poster_url || item.season_poster_url) return false;
    return item.poster_is_episode_still !== false;
  }
  const art = landscapeArt(item);
  if (!art.url) return false;
  // landscapeArt prefers the backdrop; the series backdrop it falls back to is series artwork.
  return item.backdrop_url ? item.backdrop_is_episode_still !== false : false;
}

/** Whether a card must show a blurred stand-in instead of its picture. */
export function protectsCardArt(
  item: CatalogItem,
  shape: 'poster' | 'landscape',
  settings: SpoilerSettings,
): boolean {
  return settings.images && cardUnwatched(item) && cardShowsEpisodeStill(item, shape);
}

/** Whether the image of an episode row is protected (`still_is_episode_still` false: never). */
export function protectsEpisodeStill(
  episode: EpisodeWatchData & { still_is_episode_still?: boolean },
  settings: SpoilerSettings,
): boolean {
  return (
    settings.images && episodeRowUnwatched(episode) && episode.still_is_episode_still !== false
  );
}

export function protectsEpisodeOverview(
  episode: EpisodeWatchData,
  settings: SpoilerSettings,
): boolean {
  return settings.overviews && episodeRowUnwatched(episode);
}

/**
 * What the Home hero hides for the featured item. Only an unwatched episode is affected: its own
 * still is not shown as the backdrop (the series backdrop still is, when the item offers one) and
 * its description is left out.
 */
export function heroProtection(
  item: CatalogItem,
  settings: SpoilerSettings,
): { hideBackdrop: boolean; hideOverview: boolean } {
  const unwatchedEpisode = isEpisode(item) && cardUnwatched(item);
  return {
    hideBackdrop:
      settings.images &&
      unwatchedEpisode &&
      !item.series_backdrop_url &&
      Boolean(item.backdrop_url) &&
      item.backdrop_is_episode_still !== false,
    hideOverview: settings.overviews && unwatchedEpisode,
  };
}

/**
 * The picture URL of a card for prefetching: null for a protected card, so its real still is
 * never requested ahead of time.
 */
export function useArtUrl(shape: 'poster' | 'landscape'): (item: CatalogItem) => string | null {
  const url = useMediaUrl();
  const settings = useSpoilerSettings();
  return useCallback(
    (item) => {
      if (protectsCardArt(item, shape, settings)) return null;
      return url((shape === 'landscape' ? landscapeArt(item) : posterArt(item)).url);
    },
    [shape, settings, url],
  );
}
