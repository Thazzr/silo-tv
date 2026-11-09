import type { components } from '../../api/generated/schema';
import type { Episode, ItemDetail, Season } from './info';

/** How the server wants descriptions translated for a viewer: not at all, on request, or by itself. */
export type TranslationMode = 'off' | 'button' | 'auto';

/** The server's metadata-AI capability document, as far as this feature reads it. */
export type MetadataAICapability = components['schemas']['MetadataAICapability'];

/** `button` or `auto` only when the server offers the capability to this profile and says so. */
export function translationMode(
  capability: MetadataAICapability | null | undefined,
): TranslationMode {
  if (!capability || capability.state !== 'available' || capability.allowed !== true) return 'off';
  return capability.on_view === 'button' || capability.on_view === 'auto'
    ? capability.on_view
    : 'off';
}

/**
 * The seconds to wait before each re-read of the target after the request was accepted: 45 s in
 * total, longer gaps the longer it takes.
 */
export const REREAD_DELAYS_S: readonly number[] = [1, 2, 2, 3, 3, 4, 5, 5, 5, 5, 5, 5];

/** Whether the item's own description is still missing in `language`. */
export function itemMissing(detail: ItemDetail | undefined, language: string): boolean {
  return detail?.pending_translation_language === language;
}

/** Whether any loaded episode of the season still waits for its description in `language`. */
export function seasonMissing(episodes: readonly Episode[] | undefined, language: string): boolean {
  return (episodes ?? []).some((episode) => episode.pending_translation_language === language);
}

/** What a run translates: the item itself, or the season whose episodes are on screen. */
export interface TranslationTarget {
  kind: 'item' | 'season';
  /** The content id the request goes to. */
  id: string;
  /** The language exactly as the server reported it. */
  language: string;
  /** For a season: its number, so leaving it can stop the run. */
  season?: number;
}

/**
 * The targets a page has: its item when that reports a pending language, and on a series the
 * shown season when one of its loaded episodes does (the season's content id is the request's id).
 */
export function pageTargets(input: {
  itemId: string;
  detail: ItemDetail;
  series: boolean;
  shownSeason: number | undefined;
  seasons: readonly Season[];
  episodes: readonly Episode[] | undefined;
}): TranslationTarget[] {
  const targets: TranslationTarget[] = [];
  const own = input.detail.pending_translation_language;
  if (own) targets.push({ kind: 'item', id: input.itemId, language: own });
  if (input.series && input.shownSeason !== undefined) {
    const season = input.seasons.find((s) => s.season_number === input.shownSeason);
    const pending = (input.episodes ?? []).find((e) => e.pending_translation_language);
    if (season && pending?.pending_translation_language) {
      targets.push({
        kind: 'season',
        id: season.content_id,
        language: pending.pending_translation_language,
        season: season.season_number,
      });
    }
  }
  return targets;
}
