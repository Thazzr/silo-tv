// What the box set page says about a box set, as pure functions: which film Play starts, what the
// button says and the chip line under the title.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';
import { filmCountText, yearsText, type CatalogItem } from '../../ui/media';

export type BoxSetDetail = components['schemas']['CatalogBoxSetDetail'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The film Play starts, and whether that continues a box set the profile has begun. */
export interface PlayTarget {
  item: CatalogItem;
  continuing: boolean;
}

/**
 * The first film in collection order that the profile has not played; the first film once all are
 * played (watching it again). The watch state of the films decides which one, the server's count
 * decides how it is worded: "Continue" needs some but not all played by that count, so a count and
 * a film list that disagree never produce a "Continue" for a box set that was never started.
 */
export function playTarget(
  box: Pick<BoxSetDetail, 'items' | 'played_count' | 'movie_count'>,
): PlayTarget | null {
  const first = box.items[0];
  if (!first) return null;
  const item = box.items.find((film) => film.user_state?.played !== true) ?? first;
  return {
    item,
    continuing: box.played_count > 0 && box.played_count < box.movie_count,
  };
}

/** "Continue · {film}" for a box set in progress, else "Play {film}". */
export function playLabel(target: PlayTarget, t: Translate): string {
  return t(target.continuing ? 'boxset.continue' : 'boxset.play', { film: target.item.title });
}

/**
 * The line under the title, in order and only what is known: BOX SET, the film count, the years
 * and how far the profile got once a film is played.
 */
export function chipLine(
  box: Pick<BoxSetDetail, 'movie_count' | 'first_year' | 'last_year' | 'played_count'>,
  t: Translate,
): string {
  const parts = [t('boxset.badge')];
  if (box.movie_count > 0) parts.push(filmCountText(box.movie_count, t));
  const years = yearsText(box.first_year, box.last_year);
  if (years) parts.push(years);
  if (box.played_count > 0) {
    parts.push(t('boxset.watchedOf', { played: box.played_count, count: box.movie_count }));
  }
  return parts.join(' · ');
}
