// Remembering a viewer's audio and subtitle pick for the series (an episode) or the movie, as
// Silo's web client does: `PUT /api/v2/audio-prefs/{key}` and `PUT /api/v2/subtitle-prefs/{key}`.
// Only a pick the viewer made saves one; the detail page's track choice reuses this module.
import { useMemo } from 'react';
import type { SiloClient } from '../api/client';
import type { components } from '../api/generated/schema';
import { useSilo } from '../app/SiloContext';

type S = components['schemas'];
export type AudioPreferenceBody = S['AudioPreferenceUpdate'];
export type SubtitlePreferenceBody = S['SubtitlePreferenceUpdate'];

/** How long a failed save waits before its one retry. */
export const SAVE_RETRY_MS = 2_000;

/** Codes that name no spoken language: saving one would invent a preference nobody expressed. */
const NO_LANGUAGE = new Set(['und', 'mul', 'zxx', 'mis']);

const trimmed = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * The key a title's preferences are stored under: an episode's series, else the movie itself
 * (preferences are series-scoped; a movie is its own "series"). Undefined for an episode that
 * names no series: there is nothing to remember its pick under.
 */
export const trackPrefKey = (
  title: { isEpisode: boolean; seriesId?: string },
  contentId: string,
): string | undefined => (title.isEpisode ? title.seriesId : contentId);

/**
 * The body that saves an audio track as the choice. `index` is the track's position in its
 * version's audio list. The signature carries the catalog's own fields for the track (the server
 * recognises the track in other episodes by matching them), without `default`, which says nothing
 * about what the viewer wants.
 */
export function audioPreferenceBody(
  index: number,
  track: S['WatchAudioTrack'],
): AudioPreferenceBody {
  const language = trimmed(track.language);
  const signature = {
    language,
    title: trimmed(track.title),
    embedded_title: trimmed(track.embedded_title),
    codec: trimmed(track.codec),
    layout: trimmed(track.layout),
    channels: track.channels || undefined,
  };
  const fields = Object.entries(signature).filter(([, value]) => value !== undefined);
  return {
    audio_track_index: index,
    ...(language && !NO_LANGUAGE.has(language.toLowerCase()) ? { audio_language: language } : {}),
    ...(fields.length > 0 ? { track_signature: Object.fromEntries(fields) } : {}),
  };
}

/**
 * The body that saves a subtitle pick (mode `always`), or subtitles off (mode `off`, index -1).
 * The index is the track's `combined_index` of the plan's inventory, the index the web client
 * saves; `show_forced_subtitles` stays out so the stored override is kept.
 */
export function subtitlePreferenceBody(
  track: S['SubtitleInventoryItemV3'] | null,
): SubtitlePreferenceBody {
  if (!track) return { subtitle_track_index: -1, subtitle_mode: 'off', subtitle_language: '' };
  const signature = {
    source: trimmed(track.source),
    language: trimmed(track.language),
    codec: trimmed(track.codec),
    label: trimmed(track.label),
    forced: track.forced,
    hearing_impaired: track.hearing_impaired,
  };
  return {
    subtitle_track_index: track.combined_index,
    subtitle_mode: 'always',
    subtitle_language: track.language ?? '',
    // Absent fields are left out of the JSON by themselves.
    track_signature: signature,
  };
}

export interface TrackPrefWriter {
  audio(prefId: string, index: number, track: S['WatchAudioTrack']): Promise<void>;
  /** `null` saves "subtitles off". */
  subtitle(prefId: string, track: S['SubtitleInventoryItemV3'] | null): Promise<void>;
}

/**
 * The writer for one signed-in client. A save that fails is tried once more after
 * `SAVE_RETRY_MS`, then dropped without a word: it costs the remembered track, never playback.
 * Saves for one kind and key go one after another, in the order they were made, so the viewer's
 * last pick is the one the server keeps. Resolves when the save is settled; never rejects.
 */
export function createTrackPrefWriter(
  client: Pick<SiloClient, 'PUT'>,
  profileId: () => string,
  retryMs: number = SAVE_RETRY_MS,
): TrackPrefWriter {
  // The last save of each key; a new one waits for it. A key is a profile, a kind and a title, so
  // the map stays as small as the titles the viewer picks tracks for.
  const queues = new Map<string, Promise<void>>();

  const enqueue = (profile: string, key: string, send: () => Promise<boolean>): Promise<void> => {
    // Without a profile there is nobody to save a choice for.
    if (profile === '') return Promise.resolve();
    const run = async () => {
      try {
        if (await send()) return;
      } catch {
        // Tried once more below.
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      try {
        await send();
      } catch {
        // Dropped: it costs the remembered track, never playback.
      }
    };
    const settled = (queues.get(key) ?? Promise.resolve()).then(run);
    queues.set(key, settled);
    return settled;
  };

  return {
    audio(prefId, index, track) {
      const profile = profileId();
      const body = audioPreferenceBody(index, track);
      return enqueue(profile, `${profile}\u0000audio\u0000${prefId}`, async () => {
        const { response } = await client.PUT('/api/v2/audio-prefs/{series_id}', {
          params: { path: { series_id: prefId }, header: { 'X-Profile-Id': profile } },
          body,
        });
        return response.ok;
      });
    },
    subtitle(prefId, track) {
      const profile = profileId();
      const body = subtitlePreferenceBody(track);
      return enqueue(profile, `${profile}\u0000subtitle\u0000${prefId}`, async () => {
        const { response } = await client.PUT('/api/v2/subtitle-prefs/{series_id}', {
          params: { path: { series_id: prefId }, header: { 'X-Profile-Id': profile } },
          body,
        });
        return response.ok;
      });
    },
  };
}

/** The writer of the signed-in client; the profile is read when a pick is made. */
export function useTrackPrefs(): TrackPrefWriter {
  const { client, session } = useSilo();
  return useMemo(
    () => createTrackPrefWriter(client, () => session.get()?.profileId ?? ''),
    [client, session],
  );
}
