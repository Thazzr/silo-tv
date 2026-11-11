// What the Audio and Subtitles menus list and what a pick sends, as pure functions over the plan and
// the played version's track lists. Nothing here reads or returns a path, a file name or a URL.
import type { Language } from '../../i18n';
import { languageName } from '../../i18n/languages';
import type { MediaFacts, Plan, S, SelectedTracks } from '../session/types';
import { audioCodecName, channelLayout } from './infoFormat';
import { informativeTitle, trackIndex } from './info';

type TrackIdentity = NonNullable<SelectedTracks['audio']>;
export type InventoryItem = S['SubtitleInventoryItemV3'];

export interface AudioRow {
  /** The track's position in the version's audio list (the server's audio ordinal). */
  index: number;
  track: S['WatchAudioTrack'];
  label: string;
  checked: boolean;
}

/** The server's address for an audio track: the plan's file and the track's ordinal (protocol §8). */
export const audioIdentity = (plan: Plan, index: number): TrackIdentity => ({
  id: `file:${plan.effective_media_file_id}:audio:${index}`,
  index,
});

/** The audio ordinal the plan plays, or undefined when it names none. */
export const currentAudioIndex = (plan: Plan): number | undefined =>
  trackIndex(plan.selected_tracks.audio);

const joined = (parts: (string | null | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

/** "Deutsch · AC-3 · 5.1", with the track's own title when it says more ("Commentary"). */
export function audioLabel(
  track: S['WatchAudioTrack'],
  index: number,
  lang: Language,
  unknown: (n: number) => string,
): string {
  const name = languageName(track.language, lang, track.title) ?? unknown(index + 1);
  const extra = informativeTitle(track.title);
  return joined([
    name,
    audioCodecName(track.codec),
    channelLayout(track.channels, track.layout),
    extra !== name ? extra : null,
  ]);
}

export function audioRows(
  plan: Plan,
  media: MediaFacts,
  lang: Language,
  unknown: (n: number) => string,
): AudioRow[] {
  const current = currentAudioIndex(plan);
  return media.audioTracks.map((track, index) => ({
    index,
    track,
    label: audioLabel(track, index, lang, unknown),
    checked: index === current,
  }));
}

export interface SubtitleRow {
  item: InventoryItem;
  label: string;
  forced: boolean;
  hearingImpaired: boolean;
  checked: boolean;
}

/** A label that is a subtitle file's name says nothing to a viewer. */
const FILE_NAME = /\.(srt|ass|ssa|vtt|sub|sup|idx)$/i;

/** The language's name, with the track's own title when it says more; else "Track n". */
export function subtitleLabel(
  item: InventoryItem,
  lang: Language,
  unknown: (n: number) => string,
): string {
  const label = item.label && !FILE_NAME.test(item.label.trim()) ? item.label : undefined;
  const extra = informativeTitle(label);
  const name = languageName(item.language, lang) ?? extra;
  return joined([name ?? unknown(item.combined_index + 1), extra !== name ? extra : null]);
}

/** The plan's subtitle inventory in the server's order; the selected row is checked. */
export function subtitleRows(
  plan: Plan,
  lang: Language,
  unknown: (n: number) => string,
): SubtitleRow[] {
  const selected = plan.selected_tracks.subtitle?.id;
  return plan.subtitle.inventory.map((item) => ({
    item,
    label: subtitleLabel(item, lang, unknown),
    forced: item.forced,
    hearingImpaired: item.hearing_impaired,
    checked: item.track_id === selected,
  }));
}

/**
 * The tracks a `track_change` for an audio pick names: the new audio and the subtitle the plan plays
 * now (an omitted subtitle means off, so the current one is always sent).
 */
export function tracksForAudioPick(plan: Plan, index: number): SelectedTracks {
  const subtitle = plan.selected_tracks.subtitle;
  return { audio: audioIdentity(plan, index), ...(subtitle ? { subtitle } : {}) };
}

/** The tracks for a subtitle pick (`null` = off, no subtitle member) with the current audio kept. */
export function tracksForSubtitlePick(plan: Plan, item: InventoryItem | null): SelectedTracks {
  const audio = plan.selected_tracks.audio;
  return {
    ...(audio ? { audio } : {}),
    ...(item ? { subtitle: { id: item.track_id, index: item.combined_index } } : {}),
  };
}
