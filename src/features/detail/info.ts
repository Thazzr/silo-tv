// What the detail page says about an item, as pure functions: the resume point, the metadata and
// credit lines, the quality badges and an episode's progress.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';

type S = components['schemas'];
export type ItemDetail = S['CatalogItemDetail'];
export type Season = S['Season'];
export type Episode = S['Episode'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A saved position counts as a resume point past this many seconds ... */
export const RESUME_MIN_SECONDS = 30;
/** ... and while more than this many seconds of the item are left. */
export const RESUME_END_SECONDS = 5;

interface Progress {
  position_seconds?: number;
  duration_seconds?: number;
}

/**
 * Where "Resume" starts, in whole seconds, or null when the item plays from the start. The saved
 * position must pass 30 s and be more than 5 s from the end, whether or not the server counts the
 * item played (the server keeps the position of a rewatch that stopped partway). `fallbackSeconds`
 * is the runtime to measure the end by when the watch state carries no duration.
 */
export function resumePoint(state: Progress | undefined, fallbackSeconds?: number): number | null {
  const position = state?.position_seconds ?? 0;
  if (position <= RESUME_MIN_SECONDS) return null;
  const total = state?.duration_seconds || fallbackSeconds || 0;
  if (total > 0 && total - position <= RESUME_END_SECONDS) return null;
  return Math.floor(position);
}

function runtimeText(minutes: number, t: Translate): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('media.runtime.minutes', { m });
  return m === 0 ? t('media.runtime.hours', { h }) : t('media.runtime.hoursMinutes', { h, m });
}

export function runtimeLabel(minutes: number | undefined, t: Translate): string | null {
  return minutes && minutes > 0 ? runtimeText(minutes, t) : null;
}

const isSeries = (detail: ItemDetail) => detail.type.trim().toLowerCase() === 'series';

/** Year, runtime (or the number of seasons), content rating and the first genres. */
export function metaLine(detail: ItemDetail, t: Translate): string {
  const parts: string[] = [];
  if (detail.year) parts.push(String(detail.year));
  if (isSeries(detail)) {
    if (detail.season_count && detail.season_count > 0) {
      parts.push(
        detail.season_count === 1
          ? t('detail.seasonOne')
          : t('detail.seasonCount', { count: detail.season_count }),
      );
    }
  } else {
    const runtime = runtimeLabel(detail.runtime, t);
    if (runtime) parts.push(runtime);
  }
  if (detail.content_rating) parts.push(detail.content_rating);
  parts.push(...detail.genres.slice(0, 3));
  return parts.join(' · ');
}

/** The server's chosen external ratings as "IMDb 8.5", at most three, in the server's order. */
export function ratingEntries(detail: ItemDetail): { key: string; text: string }[] {
  return detail.ratings
    .filter((rating) => rating.display)
    .slice(0, 3)
    .map((rating) => ({ key: rating.source, text: `${rating.name} ${rating.display}`.trim() }));
}

function unique(names: string[]): string[] {
  return names.filter((name, index) => name && names.indexOf(name) === index);
}

/**
 * "Directed by A, B" for a movie (up to two directors), "Starring A, B, C" for a series (the first
 * three of the cast); a movie without a director credit falls back to its cast. Empty when the
 * item names nobody.
 */
export function creditLine(detail: ItemDetail, t: Translate): string {
  const cast = [...detail.cast]
    .sort((a, b) => a.order - b.order)
    .map((person) => person.name.trim());
  if (!isSeries(detail)) {
    const directors = unique(
      detail.crew
        .filter((person) => person.job.trim().toLowerCase() === 'director')
        .map((person) => person.name.trim()),
    ).slice(0, 2);
    if (directors.length > 0) return t('detail.directedBy', { names: directors.join(', ') });
  }
  const starring = unique(cast).slice(0, 3);
  return starring.length > 0 ? t('detail.starring', { names: starring.join(', ') }) : '';
}

export type QualityBadge =
  '4K' | 'HDR10' | 'HDR10+' | 'HDR' | 'Dolby Vision' | 'Dolby Atmos' | '5.1' | '7.1';

/** Badges in the order they are drawn. */
const BADGE_ORDER: QualityBadge[] = [
  '4K',
  'Dolby Vision',
  'HDR10+',
  'HDR10',
  'HDR',
  'Dolby Atmos',
  '7.1',
  '5.1',
];

const UHD = /2160|4k|uhd/i;

/**
 * The quality badges of an item: only what one of its files really has. Resolution and range come
 * from the versions' video tracks (the version's own flags where a track says nothing), the audio
 * badges from their audio tracks. A series has no versions of its own; its best-file summary
 * (`overlay_summary`) stands in.
 */
export function qualityBadges(detail: ItemDetail): QualityBadge[] {
  const found = new Set<QualityBadge>();
  for (const version of detail.versions) {
    if (UHD.test(version.resolution)) found.add('4K');
    const tracks = version.video_tracks ?? [];
    let range = false;
    for (const track of tracks) {
      if ((track.height ?? 0) >= 2000 || (track.width ?? 0) >= 3600) found.add('4K');
      const text = `${track.video_range_type ?? ''} ${track.video_range ?? ''}`.toLowerCase();
      if (track.dolby_vision || track.dv_config_present || (track.dv_profile ?? 0) > 0) {
        found.add('Dolby Vision');
        range = true;
      }
      if (track.hdr10_plus || text.includes('hdr10+') || text.includes('hdr10plus')) {
        found.add('HDR10+');
        range = true;
      } else if (text.includes('hdr10') || track.color_transfer === 'smpte2084') {
        found.add('HDR10');
        range = true;
      }
    }
    if (version.hdr && !range) found.add('HDR');
    for (const audio of version.audio_tracks ?? []) {
      const text = `${audio.profile ?? ''} ${audio.title ?? ''} ${audio.embedded_title ?? ''} ${audio.layout ?? ''}`;
      if (/atmos|\bjoc\b/i.test(text)) found.add('Dolby Atmos');
      if (audio.channels === 6 || /5\.1/.test(audio.layout ?? '')) found.add('5.1');
      if (audio.channels === 8 || /7\.1/.test(audio.layout ?? '')) found.add('7.1');
    }
  }
  const summary = detail.versions.length === 0 ? detail.overlay_summary : undefined;
  if (summary) {
    if (UHD.test(summary.resolution ?? '')) found.add('4K');
    const hdr = (summary.hdr ?? '').toLowerCase();
    if (/dolby|dovi|\bdv\b/.test(hdr)) found.add('Dolby Vision');
    else if (hdr.includes('hdr10+')) found.add('HDR10+');
    else if (hdr.includes('hdr10')) found.add('HDR10');
    else if (hdr.includes('hdr')) found.add('HDR');
    if (/atmos/i.test(summary.audio ?? '')) found.add('Dolby Atmos');
    if (/5\.1/.test(summary.audio_channels ?? '')) found.add('5.1');
    if (/7\.1/.test(summary.audio_channels ?? '')) found.add('7.1');
  }
  return BADGE_ORDER.filter((badge) => found.has(badge));
}

/**
 * How far into an episode the profile is, 0 to 1, or null without a resume position. The rule is
 * the Resume button's (`resumePoint`), so a watched episode that is being watched again shows its
 * bar together with the check.
 */
export function episodeProgress(episode: Episode): number | null {
  const state = episode.user_data;
  const total = state?.duration_seconds || episode.runtime * 60;
  const position = resumePoint(state, total);
  if (position === null || !total || total <= 0) return null;
  return Math.max(0, Math.min(1, position / total));
}

/** An episode the profile has watched to the end. */
export function episodeWatched(episode: Episode): boolean {
  return episode.user_data?.played === true;
}

/** Numbered seasons in order, then the specials. */
export function orderSeasons(seasons: readonly Season[]): Season[] {
  const specials = (season: Season) => season.is_specials === true || season.season_number === 0;
  return [...seasons].sort((a, b) => {
    if (specials(a) !== specials(b)) return specials(a) ? 1 : -1;
    return a.season_number - b.season_number;
  });
}

/** The season shown when nothing says otherwise: the first numbered season, else the first. */
export function defaultSeason(seasons: readonly Season[]): number | undefined {
  return orderSeasons(seasons)[0]?.season_number;
}

/** "AB" for "Alex Black": what stands in for a portrait that is missing. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}
