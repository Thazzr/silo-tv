// Which file a movie or episode page describes and plays, by the web's rule, and what the Edition
// and Version pills offer. Pure functions over the item the page read.
import type { components } from '../../api/generated/schema';
import { audioCodecBadge } from '../../playback/audioLabel';
import type { ItemDetail } from './info';

type S = components['schemas'];
export type FileVersion = S['FileVersion'];
type PlaybackVariant = S['PlaybackVariant'];

const RESOLUTION_RANK: Record<string, number> = {
  '4k': 4,
  '2160p': 4,
  '1440p': 3,
  '1080p': 2,
  '720p': 1,
  '480p': 0,
};

/** How sharp a resolution label is; -1 for a label the rank does not know. */
const resolutionScore = (resolution: string): number =>
  RESOLUTION_RANK[resolution.toLowerCase()] ?? -1;

// The order of audio codecs when the best one is picked. A codec the web does not rank (AC3, ...)
// scores nothing there, and none does here.
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

export const audioScore = (codec: string): number => {
  const lower = codec.toLowerCase();
  return AUDIO_RANK.find(([key]) => lower.includes(key))?.[1] ?? -1;
};

/** The files by resolution, the sharpest first; equally sharp ones keep their order. */
export function sortByResolution(versions: readonly FileVersion[]): FileVersion[] {
  return [...versions].sort(
    (a, b) => resolutionScore(b.resolution) - resolutionScore(a.resolution),
  );
}

/**
 * The resolution, the HDR flag and the audio codec a set of files is best at. With a resolution cap
 * in the profile only files at or below it count, unless none is.
 */
function bestAttributes(versions: readonly FileVersion[], cap: string | null | undefined) {
  const maxRank = cap && cap !== 'auto' ? (RESOLUTION_RANK[cap.toLowerCase()] ?? -1) : -1;
  const within = versions.filter((version) => resolutionScore(version.resolution) <= maxRank);
  const pool = maxRank >= 0 && within.length > 0 ? within : versions;
  let resolution = '';
  let resolutionBest = -1;
  let hdr = false;
  let audioCodec = '';
  let audioBest = -1;
  for (const version of pool) {
    const rank = resolutionScore(version.resolution);
    if (rank > resolutionBest) {
      resolutionBest = rank;
      resolution = version.resolution;
    }
    if (version.hdr) hdr = true;
    // The file's own codec and every track's: a better one on a track counts too.
    const codecs = [version.codec_audio, ...(version.audio_tracks ?? []).map((t) => t.codec ?? '')];
    for (const codec of codecs) {
      const score = audioScore(codec);
      if (score > audioBest) {
        audioBest = score;
        audioCodec = codec;
      }
    }
  }
  return { resolution, hdr, audioCodec };
}

const badgeOf = (codec: string): string => (audioCodecBadge({ codec }) ?? '').toLowerCase();

/**
 * The file of `versions` to describe: the one last played (when it is in the preferred edition),
 * else, within the preferred edition, the one that matches what the set is best at (sharpest
 * resolution under the cap, HDR when any file has it, the best audio codec), else the sharpest.
 */
function pickVersion(
  versions: readonly FileVersion[],
  userData: ItemDetail['user_data'],
  cap: string | null | undefined,
  preferredEdition: string | undefined,
): FileVersion | undefined {
  if (versions.length === 0) return undefined;
  const edition = preferredEdition ?? userData?.last_edition_key;
  const lastId = userData?.last_file_id;
  if (lastId !== undefined) {
    const played = versions.find((version) => version.file_id === lastId);
    if (played && (!edition || played.edition_key === edition)) return played;
  }
  const inEdition = edition ? versions.filter((version) => version.edition_key === edition) : [];
  const candidates = inEdition.length > 0 ? inEdition : versions;
  const best = bestAttributes(candidates, cap);
  const wanted = best.audioCodec ? badgeOf(best.audioCodec) : '';
  const match = candidates.find(
    (version) =>
      version.resolution === best.resolution &&
      version.hdr === best.hdr &&
      (wanted === '' || badgeOf(version.codec_audio) === wanted),
  );
  return match ?? sortByResolution(candidates)[0];
}

/**
 * How early an edition comes: the standard cut (also an edition without a name) first, then the
 * theatrical cut, then every other edition.
 */
function editionRank(variant: PlaybackVariant): number {
  const names = [variant.edition_key, variant.edition_raw]
    .map((name) => name?.trim().toLowerCase())
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return 0;
  const standard = names.some(
    (name) =>
      name === 'standard' ||
      name === 'default' ||
      name.startsWith('standard ') ||
      name.endsWith(' standard'),
  );
  if (standard) return 0;
  return names.some((name) => name.includes('theatrical')) ? 1 : 2;
}

const firstPart = (variant: PlaybackVariant) =>
  [...variant.parts].sort((a, b) => a.part_index - b.part_index)[0];

/** The variants by edition rank; variants of one rank keep the server's order. */
const rankedVariants = (variants: readonly PlaybackVariant[]): PlaybackVariant[] =>
  variants
    .map((variant, index) => ({ variant, index }))
    .sort((a, b) => editionRank(a.variant) - editionRank(b.variant) || a.index - b.index)
    .map(({ variant }) => variant);

/**
 * The file the page describes (its runtime and quality badges) and plays, by the web's rule: the
 * edition the profile chose (else the one last played) narrows the choice, then the file last
 * played, else the part's default file, else the best fit for the profile's resolution cap
 * (`playback.preferred_quality`). Titles with several parts or editions list them as playback
 * variants; the first part of each stands for it.
 */
export function selectedVersion(detail: ItemDetail, cap?: string | null): FileVersion | undefined {
  const { versions, user_data: userData } = detail;
  const preferred = detail.effective_version_edition_key;
  const variants = detail.playback_variants ?? [];
  if (variants.length === 0) return pickVersion(versions, userData, cap, preferred);

  const edition = preferred ?? userData?.last_edition_key;
  const ranked = rankedVariants(variants);
  const chosen = edition ? ranked.filter((variant) => variant.edition_key === edition) : [];
  const rank = editionRank(ranked[0]!);
  const candidates =
    chosen.length > 0 ? chosen : ranked.filter((variant) => editionRank(variant) === rank);

  const lastId = userData?.last_file_id;
  if (lastId !== undefined) {
    for (const variant of candidates) {
      for (const part of variant.parts) {
        const played = part.versions.find((version) => version.file_id === lastId);
        if (played) return played;
      }
    }
  }
  for (const variant of candidates) {
    const part = firstPart(variant);
    if (!part) continue;
    const defaultId = part.default_file_id;
    const standing =
      defaultId === undefined
        ? undefined
        : versions.find((version) => version.file_id === defaultId);
    if (standing) return standing;
    const fit = pickVersion(part.versions, userData, cap, undefined);
    if (fit) return fit;
  }
  return pickVersion(versions, userData, cap, preferred);
}

/** The words of an edition key as a label: "directors_cut" is "Directors Cut", "imax" is "IMAX". */
function humanizedEdition(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === 'imax' ? 'IMAX' : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}

export interface EditionChoice {
  /** The variant's id. */
  id: string;
  label: string;
  /** What choosing the edition selects: the part's default file, else its sharpest. */
  defaultVersion: FileVersion;
  /** The files of the edition's first part, the sharpest first. */
  versions: FileVersion[];
  /** Every file of every part of the edition. */
  fileIds: string[];
}

export interface VersionPicker {
  /** The Edition pill's rows and the one holding the selected file; absent without a choice. */
  editions?: { options: EditionChoice[]; current: EditionChoice };
  /** The Version pill's rows, the files of the current edition; absent when it has one file. */
  versions?: FileVersion[];
}

/**
 * What the Edition and Version pills offer for the selected file. The edition pill needs several
 * editions that are called differently, at least one of them by name; the version pill needs
 * several files in the current edition (or in the title, when it has no editions to choose).
 * `standardLabel` names an edition that has no name of its own.
 */
export function versionPicker(
  detail: ItemDetail,
  selected: FileVersion,
  standardLabel: string,
): VersionPicker {
  const variants = detail.playback_variants ?? [];
  const options = rankedVariants(variants).flatMap((variant): EditionChoice[] => {
    const part = firstPart(variant);
    const versions = sortByResolution(part?.versions ?? []);
    const defaultId = part?.default_file_id;
    const defaultVersion =
      (defaultId === undefined
        ? undefined
        : detail.versions.find((version) => version.file_id === defaultId)) ?? versions[0];
    if (!defaultVersion) return [];
    const key = variant.edition_key?.trim();
    const label = variant.edition_raw?.trim() || (key ? humanizedEdition(key) : standardLabel);
    const fileIds = variant.parts.flatMap((p) => p.versions.map((version) => version.file_id));
    return [{ id: variant.variant_id, label, defaultVersion, versions, fileIds }];
  });
  const several = new Set(options.map((option) => option.label.toLowerCase())).size > 1;
  const named = variants.some((variant) => variant.edition_key);
  if (!several || !named) {
    const all = sortByResolution(detail.versions);
    return all.length > 1 ? { versions: all } : {};
  }
  const current =
    options.find((option) => option.fileIds.includes(selected.file_id)) ?? options[0]!;
  return {
    editions: { options, current },
    ...(current.versions.length > 1 ? { versions: current.versions } : {}),
  };
}
