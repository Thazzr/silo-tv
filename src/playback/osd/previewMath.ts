// The pure rules behind the scrub preview card and the chapter ticks, kept apart from React so
// each can be tested on its own.
import type { components } from '../../api/generated/schema';

export type TrickplayManifest = components['schemas']['WatchTrickplay'];

/** A chapter of the playing file, in source seconds. */
export interface Chapter {
  title: string;
  start: number;
  end: number;
}

/** The thumbnail is drawn this wide; its height follows the manifest's aspect ratio. */
export const THUMB_DISPLAY_WIDTH = 280;
/** A card with an image, a chapter or a segment line is as wide as its thumbnail. */
export const CARD_WIDTH_WIDE = THUMB_DISPLAY_WIDTH;
/** The card with the time alone (and the rate while scrubbing). */
export const CARD_WIDTH_PLAIN = 220;
/** The notch under the card stays this far from the card's rounded corners. */
export const NOTCH_MARGIN = 24;

/** Index of the thumbnail that covers `seconds`; clamped to the first and last thumbnail. */
export function tileIndex(
  seconds: number,
  manifest: Pick<TrickplayManifest, 'interval_ms' | 'thumbnail_count'>,
): number {
  const last = Math.max(0, manifest.thumbnail_count - 1);
  if (!(manifest.interval_ms > 0)) return 0;
  const index = Math.floor((Math.max(0, seconds) * 1000) / manifest.interval_ms);
  return Math.max(0, Math.min(last, index));
}

export interface TilePosition {
  sheet: number;
  column: number;
  row: number;
}

/** Where thumbnail `index` sits: every sheet has the full grid, filled left to right, top to bottom. */
export function tilePosition(index: number, columns: number, rows: number): TilePosition {
  const perSheet = columns * rows;
  const within = index % perSheet;
  return {
    sheet: Math.floor(index / perSheet),
    column: within % columns,
    row: Math.floor(within / columns),
  };
}

export interface ThumbnailBox {
  sheet: number;
  /** CSS pixels of the drawn thumbnail. */
  width: number;
  height: number;
  backgroundSize: string;
  backgroundPosition: string;
}

/**
 * The CSS that shows one thumbnail of a sheet in an element `displayWidth` wide: the whole sheet
 * is scaled to that thumbnail size and shifted so the wanted tile is the one in view.
 */
export function thumbnailBox(
  seconds: number,
  manifest: TrickplayManifest,
  displayWidth: number = THUMB_DISPLAY_WIDTH,
): ThumbnailBox {
  const { thumbnail_width: w, thumbnail_height: h, tile_columns: c, tile_rows: r } = manifest;
  const scale = displayWidth / w;
  // Hundredths of a pixel: the scale is rarely exact, and its noise would end up in the CSS.
  const px = (n: number) => Math.round(n * 100) / 100;
  const { sheet, column, row } = tilePosition(tileIndex(seconds, manifest), c, r);
  return {
    sheet,
    width: displayWidth,
    height: px(h * scale),
    backgroundSize: `${px(c * w * scale)}px ${px(r * h * scale)}px`,
    backgroundPosition: `${px(-column * w * scale)}px ${px(-row * h * scale)}px`,
  };
}

/** The card's left edge for a card centred on `centerX`, kept within `0..trackWidth`. */
export function cardLeft(centerX: number, cardWidth: number, trackWidth: number): number {
  const room = trackWidth - cardWidth;
  // A track narrower than the card cannot keep both ends in view: centre it.
  if (room <= 0) return room / 2;
  return Math.max(0, Math.min(room, centerX - cardWidth / 2));
}

/** The chapter that contains `seconds` (its end belongs to the next chapter; the last keeps its end). */
export function chapterAt(chapters: readonly Chapter[], seconds: number): Chapter | null {
  for (let i = 0; i < chapters.length; i += 1) {
    const chapter = chapters[i]!;
    const last = i === chapters.length - 1;
    if (seconds >= chapter.start && (seconds < chapter.end || (last && seconds <= chapter.end))) {
      return chapter;
    }
  }
  return null;
}

/**
 * The chapter name the card shows for `seconds`: the chapter that contains it, else the last one
 * (a gap, or a time past the last end), as Silo's web player does. Null without chapters or when
 * the chapter has no title.
 */
export function chapterTitleAt(chapters: readonly Chapter[], seconds: number): string | null {
  const title = (chapterAt(chapters, seconds) ?? chapters[chapters.length - 1])?.title.trim();
  return title ? title : null;
}

/** Where the notch stands in the card: under the time, but not past the card's corners. */
export function notchLeft(centerX: number, cardLeftEdge: number, cardWidth: number): number {
  return Math.max(NOTCH_MARGIN, Math.min(cardWidth - NOTCH_MARGIN, centerX - cardLeftEdge));
}

/** Where the ticks go on the track: every chapter start except the first second, as 0-1 fractions. */
export function chapterTickFractions(chapters: readonly Chapter[], duration: number): number[] {
  if (!(duration > 0)) return [];
  return chapters
    .map((chapter) => chapter.start / duration)
    .filter((fraction) => fraction > 0 && fraction < 1);
}

/** Maps the API's chapters to ours: in time order, with usable bounds only. */
export function toChapters(
  chapters: readonly components['schemas']['WatchChapter'][] | undefined,
): Chapter[] {
  return (chapters ?? [])
    .map((c) => ({ title: c.title, start: c.start_seconds, end: c.end_seconds }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * A sheet URL as the manifest gives it: relative ones resolve against the server origin, absolute
 * ones (an asset store) stay as they are. Only http(s) is accepted; nothing is ever appended.
 */
export function resolveSheetUrl(url: string, baseUrl: string): string | null {
  // An absolute URL is signed as written: hand it back byte for byte.
  if (/^https?:\/\//i.test(url)) return url;
  try {
    const resolved = new URL(url, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}
