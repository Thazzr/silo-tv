// "Trailer & More" on a detail page, as pure functions: which cards the row shows, in which order,
// and what their captions say. Spoiler rules do not apply to extras (they hold no plot of the
// title's episodes), so nothing here consults them.
import type { components } from '../../api/generated/schema';
import type { MessageKey } from '../../i18n';
import { isValidYouTubeVideoId } from '../../platform';
import { formatClock } from '../../playback/format';
import type { ItemDetail } from './info';

type S = components['schemas'];
export type ItemExtra = S['ItemExtraInfo'];
export type ItemVideo = S['ItemVideoInfo'];

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The row shows at most this many local extras (and, separately, this many YouTube videos). */
export const EXTRAS_LIMIT = 24;

/** The card of one entry of the row. */
export type ExtraEntry =
  | { type: 'local'; key: string; extra: ItemExtra }
  | { type: 'youtube'; key: string; video: ItemVideo; videoId: string };

const KIND_LABELS: Record<string, MessageKey> = {
  trailer: 'extras.kind.trailer',
  teaser: 'extras.kind.teaser',
  featurette: 'extras.kind.featurette',
  clip: 'extras.kind.clip',
  behind_the_scenes: 'extras.kind.behindTheScenes',
  bloopers: 'extras.kind.bloopers',
  deleted_scene: 'extras.kind.deletedScene',
  other: 'extras.kind.other',
};

/** The label of a kind; a kind the app does not know (a newer server) reads as "Extra". */
export function extraKindLabel(kind: string, t: Translate): string {
  const key = Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)
    ? KIND_LABELS[kind]
    : undefined;
  return t(key ?? 'extras.kind.other');
}

/** A card's caption: the title when there is one, else the kind's label. */
export function extraCaption(title: string | undefined, kind: string, t: Translate): string {
  const own = title?.trim();
  return own ? own : extraKindLabel(kind, t);
}

/** The runtime under a local extra's caption ("2:05", "1:02:03"), or empty without a duration. */
export function extraRuntime(seconds: number | undefined): string {
  return seconds && seconds > 0 ? formatClock(seconds) : '';
}

/** Local extras in the server's order (trailers first), at most `EXTRAS_LIMIT`. */
export function localExtras(detail: Pick<ItemDetail, 'extras'>): ItemExtra[] {
  return (detail.extras ?? []).filter((extra) => extra.content_id).slice(0, EXTRAS_LIMIT);
}

/** YouTube videos in the server's order; another site, or a key that is no plain id, is left out. */
export function youtubeVideos(detail: Pick<ItemDetail, 'videos'>): ItemVideo[] {
  return (detail.videos ?? [])
    .filter((video) => video.site.trim().toLowerCase() === 'youtube')
    .filter((video) => isValidYouTubeVideoId(video.site_key))
    .slice(0, EXTRAS_LIMIT);
}

/** All cards of the row: the local extras first, then the YouTube videos. */
export function extraEntries(detail: Pick<ItemDetail, 'extras' | 'videos'>): ExtraEntry[] {
  const local = localExtras(detail).map((extra): ExtraEntry => ({
    type: 'local',
    key: `local:${extra.content_id}`,
    extra,
  }));
  const remote = youtubeVideos(detail).map((video): ExtraEntry => ({
    type: 'youtube',
    key: `youtube:${video.site_key}`,
    video,
    videoId: video.site_key,
  }));
  return [...local, ...remote];
}
