// The extras of a detail page, as pure functions: which cards the "Extras" rows and the "Trailers
// & More" row show, in which order, and what their captions say. Spoiler rules do not apply to extras (they hold no plot of the
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

/** Each section shows at most this many local extras (and, separately, this many YouTube videos). */
export const EXTRAS_LIMIT = 24;

/** The kinds the server knows: the singular label of a card, the plural heading of a group. */
const KIND_LABELS = {
  trailer: ['extras.kind.trailer', 'extras.group.trailer'],
  teaser: ['extras.kind.teaser', 'extras.group.teaser'],
  featurette: ['extras.kind.featurette', 'extras.group.featurette'],
  clip: ['extras.kind.clip', 'extras.group.clip'],
  behind_the_scenes: ['extras.kind.behindTheScenes', 'extras.group.behindTheScenes'],
  bloopers: ['extras.kind.bloopers', 'extras.group.bloopers'],
  deleted_scene: ['extras.kind.deletedScene', 'extras.group.deletedScene'],
  other: ['extras.kind.other', 'extras.group.other'],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;
export type ExtraKind = keyof typeof KIND_LABELS;

/** A kind the app does not know (a newer server) is "other". */
function knownKind(kind: string): ExtraKind {
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? (kind as ExtraKind) : 'other';
}

/** The label of a kind, singular ("Trailer"); a kind the app does not know reads as "Extra". */
export function extraKindLabel(kind: string, t: Translate): string {
  return t(KIND_LABELS[knownKind(kind)][0]);
}

/** The heading of a kind's group of extras, plural ("Trailers"); an unknown kind is "Other". */
export function extraGroupLabel(kind: ExtraKind, t: Translate): string {
  return t(KIND_LABELS[kind][1]);
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

/** One kind's local extras: a row under its own heading. */
export interface ExtraGroup {
  kind: ExtraKind;
  extras: ItemExtra[];
}

/** The local extras grouped by kind, in the order the server's list first shows each kind. */
export function extraGroups(detail: Pick<ItemDetail, 'extras'>): ExtraGroup[] {
  const groups: ExtraGroup[] = [];
  for (const extra of localExtras(detail)) {
    const kind = knownKind(extra.kind);
    const group = groups.find((one) => one.kind === kind);
    if (group) group.extras.push(extra);
    else groups.push({ kind, extras: [extra] });
  }
  return groups;
}
