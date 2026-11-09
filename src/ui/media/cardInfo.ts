// What a card shows of a catalog item, as pure functions: its caption lines, the picture it uses
// and how far along it is.
import type { components } from '../../api/generated/schema';

export type CatalogItem = components['schemas']['CatalogItem'];

/**
 * The widths the app asks the server for, in device pixels per image slot. The server answers
 * with the narrowest cached size that is at least this wide (poster ladder 300/500/1000, backdrop
 * 300/1920/2560, still 300/500/1280, logo 500/500/1280), so a row of 176 px cards gets the 500 px
 * poster and nothing is fetched at a size the screen cannot use. The numbers are the card widths
 * at the TV's 2x device pixel ratio; the backdrop is the hero's full-bleed picture at 1x, and
 * also serves the landscape cards.
 */
export const IMAGE_WIDTHS = {
  rowPoster: 352,
  gridPoster: 520,
  backdrop: 1920,
  logo: 880,
  still: 720,
} as const;

/** The image query of a request that fills rows and the hero. */
export const ROW_IMAGE_QUERY = {
  poster_width: IMAGE_WIDTHS.rowPoster,
  backdrop_width: IMAGE_WIDTHS.backdrop,
  logo_width: IMAGE_WIDTHS.logo,
  still_width: IMAGE_WIDTHS.still,
} as const;

/** The image query of a request that fills a browse grid of posters. */
export const GRID_IMAGE_QUERY = {
  poster_width: IMAGE_WIDTHS.gridPoster,
  still_width: IMAGE_WIDTHS.still,
} as const;

const isEpisode = (item: CatalogItem) => item.type.trim().toLowerCase() === 'episode';

/** An episode is shown under its series; the episode's own title only when the series is unknown. */
export function cardTitle(item: CatalogItem): string {
  return isEpisode(item) ? item.series_title || item.title : item.title;
}

/** "S1 · E3" for an episode that knows both numbers, else the year of a movie or series. */
export function cardSubtitle(item: CatalogItem): string {
  if (isEpisode(item)) return episodeLabel(item) ?? '';
  return item.year ? String(item.year) : '';
}

export function episodeLabel(item: CatalogItem): string | null {
  if (item.season_number === undefined || item.episode_number === undefined) return null;
  return `S${item.season_number} · E${item.episode_number}`;
}

/** A poster card's picture; an episode shows its series (or season) poster rather than a still. */
export function posterArt(item: CatalogItem): { url?: string; thumbhash?: string } {
  if (isEpisode(item)) {
    if (item.series_poster_url) {
      return { url: item.series_poster_url, thumbhash: item.series_poster_thumbhash };
    }
    if (item.season_poster_url) {
      return { url: item.season_poster_url, thumbhash: item.season_poster_thumbhash };
    }
  }
  return { url: item.poster_url, thumbhash: item.poster_thumbhash };
}

/** A landscape card's picture: the backdrop (in Continue Watching it is the season or series'). */
export function landscapeArt(item: CatalogItem): { url?: string; thumbhash?: string } {
  if (item.backdrop_url) return { url: item.backdrop_url, thumbhash: item.backdrop_thumbhash };
  if (item.series_backdrop_url) {
    return { url: item.series_backdrop_url, thumbhash: item.series_backdrop_thumbhash };
  }
  return {};
}

/**
 * How far into the item the profile is, 0 to 1, or null when there is no resume position. A
 * "next up" card has none: nothing of it has been watched yet.
 */
export function watchedFraction(item: CatalogItem): number | null {
  const position = item.position_seconds;
  if (!position || position <= 0 || item.item_source === 'next_up') return null;
  const total = item.duration_seconds ?? (item.runtime ? item.runtime * 60 : 0);
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(1, position / total));
}

/** Sections that show landscape cards: Continue Watching, anything in progress, any "next" row. */
export function isLandscapeSection(sectionType: string): boolean {
  return /continue|in_progress|next/i.test(sectionType);
}
