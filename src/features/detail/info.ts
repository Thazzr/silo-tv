// What the detail page says about an item, as pure functions: the resume point, the metadata and
// credit lines, the quality badges and an episode's progress.
import type { components } from '../../api/generated/schema';
import type { Language, MessageKey } from '../../i18n';
import { audioCodecBadge, type AudioTrackFormat } from '../../playback/audioLabel';
import { resumePoint } from '../../playback/resume';
import { parseDate } from '../person/info';

type S = components['schemas'];
export type ItemDetail = S['CatalogItemDetail'];
export type Season = S['Season'];
export type Episode = S['Episode'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const isSeries = (detail: ItemDetail) => detail.type.trim().toLowerCase() === 'series';
export const isSeason = (detail: ItemDetail) => detail.type.trim().toLowerCase() === 'season';
export const isEpisodeDetail = (detail: ItemDetail) =>
  detail.type.trim().toLowerCase() === 'episode';

/** Which page layout an item gets: a series, a season, an episode, or the movie layout. */
export type DetailKind = 'series' | 'season' | 'episode' | 'item';
export function detailKind(detail: ItemDetail): DetailKind {
  if (isSeries(detail)) return 'series';
  if (isSeason(detail)) return 'season';
  return isEpisodeDetail(detail) ? 'episode' : 'item';
}

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

/** The runtime chip of an item: the selected version's duration, else the item's own runtime. */
function itemRuntimeChip(detail: ItemDetail, t: Translate): string | null {
  const seconds = selectedVersion(detail)?.duration ?? 0;
  return runtimeChip(seconds > 0 ? Math.round(seconds / 60) : (detail.runtime ?? 0), t);
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
 * season list, so they are missing until that has loaded: it is empty before). A season: the year
 * it first aired, its indicator ("Season 1", "Specials") and its number of episodes, which falls
 * back to `loadedEpisodes` when the item carries none.
 */
export function detailChips(
  detail: ItemDetail,
  seasons: readonly Season[],
  t: Translate,
  loadedEpisodes = 0,
): string[] {
  if (isSeason(detail)) {
    const count = detail.episode_count ?? loadedEpisodes;
    return [
      yearOf(detail.air_date)?.toString() ?? '',
      seasonIndicator(detail, t),
      count > 0 ? episodeCountText(count, t) : '',
    ].filter(Boolean);
  }
  const chips: (string | null)[] = [yearChip(detail), detail.content_rating ?? null];
  if (isSeries(detail)) {
    const episodes = seasons.reduce((sum, season) => sum + (season.episode_count ?? 0), 0);
    const count = seasons.length;
    if (count > 0) {
      chips.push(count === 1 ? t('detail.seasonOne') : t('detail.seasonCount', { count }));
    }
    if (episodes > 0) chips.push(episodeCountText(episodes, t));
  } else {
    chips.push(itemRuntimeChip(detail, t));
  }
  return chips.filter((chip): chip is string => Boolean(chip));
}

/**
 * The chips of an episode page: the runtime of the selected version (the item's own runtime when
 * the version has none), then the air date in the medium format. Either may be missing.
 */
export function episodeChips(detail: ItemDetail, lang: Language, t: Translate): string[] {
  return [itemRuntimeChip(detail, t), mediumDate(detail.air_date, lang)].filter(
    (chip): chip is string => Boolean(chip),
  );
}

/** "1 episode" / "7 episodes" (German "1 Folge" / "7 Folgen"). */
export function episodeCountText(count: number, t: Translate): string {
  return count === 1 ? t('detail.episodeOne') : t('detail.episodeCount', { count });
}

export interface HeroSynopsis {
  /** The text the hero (and "More") shows; null when there is none to show. */
  text: string | null;
  /** The profile's spoiler protection leaves the text out: the hero says so instead. */
  hidden: boolean;
  /** The text is the series' (the episode has none of its own). */
  fromSeries: boolean;
}

/**
 * What the synopsis of a page says. An episode without a description of its own shows its series'
 * (never hidden: it gives nothing away); with one, spoiler protection (`protectOwn`) hides it.
 */
export function heroSynopsis(
  detail: ItemDetail,
  seriesOverview: string | undefined,
  protectOwn: boolean,
): HeroSynopsis {
  if (detail.overview) {
    return {
      text: protectOwn ? null : detail.overview,
      hidden: protectOwn,
      fromSeries: false,
    };
  }
  if (isEpisodeDetail(detail) && seriesOverview) {
    return { text: seriesOverview, hidden: false, fromSeries: true };
  }
  return { text: null, hidden: false, fromSeries: false };
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
 * two at most) and all genres (an episode's line has no genres).
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
    // An episode's line names its director and writers only.
    genres: isEpisodeDetail(detail) ? [] : detail.genres,
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

/** A season the server marks as the specials, or season 0. */
export const isSpecials = (season: { is_specials?: boolean; season_number?: number }) =>
  season.is_specials === true || season.season_number === 0;

/** The seasons by number, as the web lists them: the specials (season 0) come first. */
export function orderSeasons(seasons: readonly Season[]): Season[] {
  return [...seasons].sort((a, b) => a.season_number - b.season_number);
}

/** The season a series plays from when the server names no target: the first numbered one, else the first. */
export function defaultSeason(seasons: readonly Season[]): number | undefined {
  const ordered = orderSeasons(seasons);
  return (ordered.find((season) => !isSpecials(season)) ?? ordered[0])?.season_number;
}

interface SeasonNames {
  title?: string;
  season_number?: number;
  is_specials?: boolean;
}

/** A season title the server filled in itself ("Season 1" is its placeholder, not a name). */
function customSeasonTitle(season: SeasonNames): string | null {
  const title = season.title?.trim() ?? '';
  return title === '' || /^season\s+\d+$/i.test(title) || isSpecials(season) ? null : title;
}

/** "Season 1" or "Specials": what numbers the season, whatever its title says. */
export function seasonIndicator(season: SeasonNames, t: Translate): string {
  return isSpecials(season)
    ? t('detail.specials')
    : t('detail.season', { number: season.season_number ?? 0 });
}

/** What a season is called: its own title when it has one, else its indicator. */
export function seasonLabel(season: SeasonNames, t: Translate): string {
  return customSeasonTitle(season) ?? seasonIndicator(season, t);
}

/**
 * The line under the series title: the season's label when it differs from the (translated)
 * indicator. A server that sends "Staffel 2" for a German viewer therefore adds no line.
 */
export function seasonSubtitle(season: SeasonNames, t: Translate): string | null {
  const label = seasonLabel(season, t);
  return label === seasonIndicator(season, t) ? null : label;
}

/** Whether the profile has started the season without finishing it. */
function seasonStarted(season: Season): boolean {
  const state = season.user_data;
  return (
    state?.played !== true &&
    ((state?.watched_count ?? 0) > 0 || (state?.in_progress_count ?? 0) > 0)
  );
}

/** The bar on a season's poster, 0 to 1: full once watched, else the watched share of its episodes. */
export function seasonProgress(season: Season): number | null {
  if (season.user_data?.played === true) return 1;
  if (!seasonStarted(season) || season.episode_count <= 0) return null;
  return Math.min(1, (season.user_data?.watched_count ?? 0) / season.episode_count);
}

/** "7 episodes", or "3 of 7 episodes" while the season is being watched. */
export function seasonCountText(season: Season, t: Translate): string {
  if (!seasonStarted(season)) return episodeCountText(season.episode_count, t);
  const watched = season.user_data?.watched_count ?? 0;
  return season.episode_count === 1
    ? t('detail.seasonProgressOne', { watched })
    : t('detail.seasonProgress', { watched, count: season.episode_count });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "S01E03" (German "S01F03"): the code in front of an episode's title. */
export function episodeCode(episode: Episode, t: Translate): string {
  return t('detail.episodeCode', {
    season: pad2(episode.season_number),
    episode: pad2(episode.episode_number),
  });
}

/** The first line of an episode's caption: "S01E03 · Title", or the code alone without a title. */
export function episodeCaptionTitle(episode: Episode, t: Translate): string {
  const title = episode.title.trim();
  return title === '' ? episodeCode(episode, t) : `${episodeCode(episode, t)} · ${title}`;
}

/** "Jan 20, 2008" / "20. Jan. 2008": the web's medium date; text that is not a date shows as sent. */
function mediumDate(iso: string | undefined, lang: Language): string | null {
  const date = parseDate(iso);
  if (!date) return iso?.trim() || null;
  // UTC on both sides: a calendar date has no time zone.
  return new Intl.DateTimeFormat(lang, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

/** The second line of an episode's caption: air date and runtime; either may be missing. */
export function episodeMetaLine(episode: Episode, lang: Language, t: Translate): string {
  const parts = [mediumDate(episode.air_date, lang), runtimeChip(episode.runtime, t)];
  // Two no-break spaces on each side of the dot, as the web sets it.
  return parts.filter(Boolean).join('  ·  ');
}

/** "AB" for "Alex Black": what stands in for a portrait that is missing. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}
