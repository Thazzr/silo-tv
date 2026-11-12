import type { Language, MessageKey } from '../../i18n';
import { isEpisode, primaryRatingText, type CatalogItem } from '../../ui/media';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The most genres the line names. */
const MAX_GENRES = 2;

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

const wholeNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0;

/** "1 Std. 58 Min.", "45 Min." or "2 Std." (en "1h 58m", "45 min", "2h"): the web hero's runtime. */
function runtimeText(item: CatalogItem, t: Translate): string | null {
  const seconds = positive(item.runtime) ? item.runtime * 60 : item.duration_seconds;
  const minutes = positive(seconds) ? Math.round(seconds / 60) : 0;
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('media.runtime.minutes', { m });
  return m === 0 ? t('media.runtime.hours', { h }) : t('media.runtime.hoursMinutes', { h, m });
}

/**
 * The line under a hero's title, as the web shows it. A title: year, runtime, the first rating
 * source with its score as text, up to two genres, the content rating. An episode: "S1 · F3",
 * runtime and content rating (no year, rating or genres).
 */
export function heroMeta(item: CatalogItem, context: { t: Translate; lang: Language }): string {
  const { t } = context;
  const parts: (string | null)[] = [];
  const contentRating = item.content_rating?.trim().toUpperCase() || null;
  if (isEpisode(item)) {
    if (wholeNumber(item.season_number) && wholeNumber(item.episode_number)) {
      parts.push(
        t('hero.episodeIdentity', { season: item.season_number, episode: item.episode_number }),
      );
    }
    parts.push(runtimeText(item, t), contentRating);
  } else {
    const genres = [...new Set((item.genres ?? []).map((genre) => genre.trim()).filter(Boolean))];
    parts.push(
      positive(item.year) && Number.isInteger(item.year) ? String(item.year) : null,
      runtimeText(item, t),
      primaryRatingText(item, context),
      ...genres.slice(0, MAX_GENRES),
      contentRating,
    );
  }
  return parts.filter(Boolean).join(' · ');
}
