// What the detail page says about an item, as pure functions: the resume point, the metadata and
// credit lines, the quality badges and an episode's progress.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';
import { audioCodecBadge, type AudioTrackFormat } from '../../playback/audioLabel';
import { resumePoint } from '../../playback/resume';

type S = components['schemas'];
export type ItemDetail = S['CatalogItemDetail'];
export type Season = S['Season'];
export type Episode = S['Episode'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function runtimeText(minutes: number, t: Translate): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('media.runtime.minutes', { m });
  return m === 0 ? t('media.runtime.hours', { h }) : t('media.runtime.hoursMinutes', { h, m });
}

export function runtimeLabel(minutes: number | undefined, t: Translate): string | null {
  return minutes && minutes > 0 ? runtimeText(minutes, t) : null;
}

export const isSeries = (detail: ItemDetail) => detail.type.trim().toLowerCase() === 'series';

type FileVersion = S['FileVersion'];

const RESOLUTION_RANK: Record<string, number> = {
  '4k': 4,
  '2160p': 4,
  '1440p': 3,
  '1080p': 2,
  '720p': 1,
  '480p': 0,
};

const resolutionScore = (resolution: string): number =>
  RESOLUTION_RANK[resolution.toLowerCase()] ?? -1;

/**
 * The version the page describes (its runtime and quality badges): the one the profile played
 * last, else the one the server resolved for the profile (`effective_version_*`), else the sharpest
 * one; an edition the profile chose narrows the choice first.
 */
export function selectedVersion(detail: ItemDetail): FileVersion | undefined {
  const edition = detail.effective_version_edition_key ?? detail.user_data?.last_edition_key;
  const inEdition = detail.versions.filter((version) => version.edition_key === edition);
  const candidates = inEdition.length > 0 ? inEdition : detail.versions;
  const last = detail.user_data?.last_file_id;
  const played = candidates.find((version) => version.file_id === last);
  if (played) return played;
  const resolved = candidates.find(
    (version) =>
      version.resolution === detail.effective_version_resolution &&
      version.hdr === detail.effective_version_hdr,
  );
  if (resolved) return resolved;
  return [...candidates].sort(
    (a, b) => resolutionScore(b.resolution) - resolutionScore(a.resolution),
  )[0];
}

const yearOf = (date: string | undefined): number | undefined => {
  const year = Number.parseInt(date ?? '', 10);
  return Number.isNaN(year) ? undefined : year;
};

/** "2008–2013" for a series that ran over several years, else its first year; a movie's year. */
function yearChip(detail: ItemDetail): string | null {
  if (!isSeries(detail)) return detail.year ? String(detail.year) : null;
  const first = yearOf(detail.first_air_date) ?? detail.year;
  if (!first) return null;
  const last = yearOf(detail.last_air_date);
  return last !== undefined && last !== first ? `${first}–${last}` : String(first);
}

/** "1 Std. 43 Min." / "43 Min." (en "1h 43m" / "43m"): the web's runtime chip, hours with minutes. */
function runtimeChip(minutes: number, t: Translate): string | null {
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('detail.runtimeHoursMinutes', { h, m }) : t('detail.runtimeMinutes', { m });
}

/**
 * The chips under the title, in the web's order. A movie: year, content rating, runtime of the
 * selected version. A series: years, content rating, the numbers of seasons and episodes (from the
 * season list, so they are missing until that has loaded: it is empty before).
 */
export function detailChips(
  detail: ItemDetail,
  seasons: readonly Season[],
  t: Translate,
): string[] {
  const chips: (string | null)[] = [yearChip(detail), detail.content_rating ?? null];
  if (isSeries(detail)) {
    const episodes = seasons.reduce((sum, season) => sum + (season.episode_count ?? 0), 0);
    const count = seasons.length;
    if (count > 0) {
      chips.push(count === 1 ? t('detail.seasonOne') : t('detail.seasonCount', { count }));
    }
    if (episodes > 0) {
      chips.push(
        episodes === 1 ? t('detail.episodeOne') : t('detail.episodeCount', { count: episodes }),
      );
    }
  } else {
    const seconds = selectedVersion(detail)?.duration ?? 0;
    chips.push(runtimeChip(seconds > 0 ? Math.round(seconds / 60) : (detail.runtime ?? 0), t));
  }
  return chips.filter((chip): chip is string => Boolean(chip));
}

/** The type and, when the item has one, its first studio (movie) or network (series). */
export function kicker(detail: ItemDetail, t: Translate): { type: string; name: string | null } {
  const series = isSeries(detail);
  return {
    type: t(series ? 'detail.kicker.series' : 'detail.kicker.movie'),
    name: (series ? detail.networks : detail.studios)?.[0] || null,
  };
}

/** The server's chosen external ratings as source name and score, every one, in its order. */
export function ratingEntries(detail: ItemDetail): { key: string; name: string; value: string }[] {
  return detail.ratings
    .filter((rating) => rating.display)
    .map((rating) => ({ key: rating.source, name: rating.name, value: rating.display }));
}

function unique(names: string[]): string[] {
  return names.filter((name, index) => name && names.indexOf(name) === index);
}

export interface HeroCredits {
  /** The leading credit, then the writers; each with its label and its names joined by ", ". */
  credits: { label: string; names: string }[];
  genres: string[];
}

/**
 * The credit line under the synopsis, as the web draws it: the lead credit (a movie's directors; a
 * series' creators, else its directors; two names at most), the writers (job Writer or Screenplay,
 * two at most) and all genres.
 */
export function heroCredits(detail: ItemDetail, t: Translate): HeroCredits {
  const named = (jobs: readonly string[]) =>
    unique(
      detail.crew
        .filter((person) => jobs.includes(person.job.trim().toLowerCase()))
        .map((person) => person.name.trim()),
    ).slice(0, 2);
  const series = isSeries(detail);
  const creators = series ? named(['creator']) : [];
  const lead = creators.length > 0 ? creators : named(['director']);
  const credits = [
    { label: t(series ? 'detail.credit.createdBy' : 'detail.credit.directedBy'), names: lead },
    { label: t('detail.credit.writtenBy'), names: named(['writer', 'screenplay']) },
  ];
  return {
    credits: credits
      .filter((credit) => credit.names.length > 0)
      .map((credit) => ({ label: credit.label, names: credit.names.join(', ') })),
    genres: detail.genres,
  };
}

// The order of a version's audio codecs when the best one is picked for the badge. A codec the web
// does not rank (AC3, ...) never gets a badge there, and none does here.
const AUDIO_RANK: [string, number][] = [
  ['atmos', 6],
  ['truehd', 5],
  ['dts-hd', 4],
  ['dts:x', 4],
  ['dts', 3],
  ['flac', 2],
  ['eac3', 1],
  ['e-ac-3', 1],
  ['aac', 0],
];

const audioScore = (codec: string): number => {
  const lower = codec.toLowerCase();
  return AUDIO_RANK.find(([key]) => lower.includes(key))?.[1] ?? -1;
};

/**
 * The audio badge of a version: its best-ranked audio codec, worded by the player's rule
 * (`audioCodecBadge`); of two equally ranked tracks the Atmos one (equal ranks differ in their
 * wording only by Atmos evidence). The file's own codec counts as a track too, for a version that
 * lists none.
 */
function audioBadge(version: FileVersion): string | null {
  const own: AudioTrackFormat[] = version.codec_audio ? [{ codec: version.codec_audio }] : [];
  let best: { badge: string; score: number } | null = null;
  for (const track of [...own, ...(version.audio_tracks ?? [])]) {
    const score = audioScore(track.codec ?? '');
    const badge = audioCodecBadge(track);
    const atmosOverBest = best !== null && score === best.score && !best.badge.includes('Atmos');
    if (badge !== null && score >= 0 && (best === null || score > best.score || atmosOverBest)) {
      best = { badge, score };
    }
  }
  return best?.badge ?? null;
}

function trackHasDolbyVision(track: S['VideoTrack']): boolean {
  if (track.dolby_vision?.trim()) return true;
  if ((track.dv_profile ?? 0) > 0) return true;
  return (track.video_range_type?.trim() ?? '').startsWith('DOVI');
}

// The HDR variant a track names: from the scanner's range type, else from the colour transfer.
function trackHdrType(track: S['VideoTrack']): string {
  const type = track.video_range_type?.trim() ?? '';
  if (track.hdr10_plus || type.includes('HDR10Plus')) return 'HDR10+';
  if (type === 'HDR10' || type.endsWith('WithHDR10')) return 'HDR10';
  if (type === 'HLG' || type.endsWith('WithHLG')) return 'HLG';
  const transfer = track.color_transfer?.toLowerCase() ?? '';
  if (transfer.includes('smpte2084')) return 'HDR10';
  if (transfer.includes('arib-std-b67')) return 'HLG';
  return '';
}

/**
 * The dynamic range of a version as the web labels it: "DV", "DV HDR10", "DV HDR10+", "DV HLG",
 * "HDR10+", "HDR10", "HLG" or the bare "HDR" (only the file's flag says so); "" for SDR.
 */
export function videoRangeLabel(version: FileVersion): string {
  const tracks = version.video_tracks ?? [];
  const dolby = tracks.some(trackHasDolbyVision);
  const hdr = tracks.map(trackHdrType).find(Boolean) ?? '';
  if (dolby) return hdr ? `DV ${hdr}` : 'DV';
  if (hdr) return hdr;
  return version.hdr ? 'HDR' : '';
}

/**
 * The quality badges of a movie, from the selected version: resolution ("2160P"), dynamic range
 * and the best audio codec. A series has none.
 */
export function qualityBadges(detail: ItemDetail): string[] {
  const version = isSeries(detail) ? undefined : selectedVersion(detail);
  if (!version) return [];
  return [
    version.resolution.toUpperCase(),
    videoRangeLabel(version),
    audioBadge(version) ?? '',
  ].filter(Boolean);
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
