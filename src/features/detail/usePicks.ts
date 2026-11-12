// The choices a movie or episode page holds before Play: which file, which audio track and which
// subtitle. The pills show them, the chips and quality badges follow the file, and Play starts
// with them.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage, useT } from '../../i18n';
import type { StartChoices } from '../../playback/resume';
import { playingAudioLanguage, subtitleSettings } from '../../playback/subtitleAuto';
import { trackPrefKey, useTrackPrefs } from '../../playback/trackPrefs';
import { useProfileSettings } from '../settings/profileSettings';
import type { DetailKind, ItemDetail } from './info';
import {
  audioRows,
  audioSummary,
  autoAudioIndex,
  autoSubtitle,
  startChoices,
  subtitleLists,
  subtitlePill,
  type AudioRow,
  type SubtitleLists,
  type SubtitlePick,
  type SubtitlePill,
  type SubtitleRow,
} from './pills';
import { useStoredSubtitles } from './queries';
import { selectedVersion, versionPicker, type FileVersion, type VersionPicker } from './versions';

/** How long Play waits for the title's pending track saves before it starts anyway. */
export const SAVE_WAIT_MS = 3000;

const AUTO: SubtitlePick = { mode: 'auto' };
const NO_SUBTITLES: SubtitleLists = { embedded: [], external: [], downloaded: [], all: [] };
const NO_TRACKS: NonNullable<FileVersion['audio_tracks']> = [];

/**
 * A choice that is shown at once and saved in the background. When the save fails the shown
 * choice goes back to the last one the server kept, unless the viewer has chosen again since: it
 * never shows a choice the server did not keep. `forget` returns to the initial choice without
 * saving anything (another file's track list means something else).
 */
function useKeptChoice<T>(initial: T) {
  const [shown, setShown] = useState<T>(initial);
  const kept = useRef(initial);
  // Bumped by every choice, so a failure only takes back the latest choice.
  const latest = useRef(0);
  // Bumped by every forget, so a save that lands later cannot say what the server keeps now.
  const era = useRef(0);
  const choose = useCallback((next: T, save: () => Promise<boolean>, landed: () => void) => {
    const choice = ++latest.current;
    const born = era.current;
    setShown(next);
    void save().then((saved) => {
      if (saved) {
        if (era.current === born) kept.current = next;
        landed();
      } else if (latest.current === choice) {
        setShown(kept.current);
      }
    });
  }, []);
  const forget = useCallback(() => {
    era.current += 1;
    kept.current = initial;
    setShown(initial);
  }, [initial]);
  return { shown, choose, forget };
}

export interface AudioPill {
  /** The pill's value ("Auto: German · EAC3 · 5.1" or the chosen track). */
  summary: string;
  /** The Auto row's second line: the track Auto plays. */
  autoDescription: string;
  /** The chosen track's index; null while Auto is. */
  checked: number | null;
  rows: AudioRow[];
  pick: (index: number) => void;
  reset: () => void;
}

export interface SubtitlePills extends SubtitlePill {
  lists: SubtitleLists;
  /** The downloaded subtitles are being read. */
  loading: boolean;
  /** Reads the downloaded subtitles; the list calls it when it opens. */
  load: () => void;
  pick: (row: SubtitleRow) => void;
  off: () => void;
  reset: () => void;
}

export interface Pills {
  /** The file the pills describe: the page's selected one. */
  version: FileVersion;
  /** The rows of the Edition and Version pills. */
  picker: VersionPicker;
  selectVersion: (fileId: string) => void;
  /** Absent for a file without audio tracks. */
  audio: AudioPill | null;
  subtitles: SubtitlePills;
}

export interface Picks {
  /** The file the page describes and plays; absent on a series or season page and without files. */
  version: FileVersion | undefined;
  /** Absent where the page has no pills (a series, a season, a title without a file). */
  pills: Pills | undefined;
  /** What Play tells the player to start with. */
  choices: StartChoices;
  /**
   * Null when no track save is under way; else a promise that settles when they have (at most
   * `SAVE_WAIT_MS`). The player reads the saved preference at its start, so Play waits for it.
   */
  whenSaved: () => Promise<void> | null;
}

/**
 * The picks of a movie or episode page. The file starts as the web's rule says; a pick of another
 * file holds while the page is open, resets the audio and subtitle choices to Auto and saves
 * nothing. An audio or subtitle pick is saved at once as the title's preference (the series' for
 * an episode, as in the player), and Auto forgets it.
 */
export function usePicks(detail: ItemDetail, kind: DetailKind): Picks {
  const t = useT();
  const lang = useLanguage();
  const queryClient = useQueryClient();
  const prefs = useTrackPrefs();
  const { values } = useProfileSettings();
  const hasFile = kind === 'item' || kind === 'episode';

  const standing = useMemo(
    () => (hasFile ? selectedVersion(detail, values['playback.preferred_quality']) : undefined),
    [detail, hasFile, values],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const version =
    pickedId === null
      ? standing
      : (detail.versions.find((one) => one.file_id === pickedId) ?? standing);

  const audio = useKeptChoice<number | null>(null);
  const subtitle = useKeptChoice<SubtitlePick>(AUTO);
  // The file whose downloaded subtitles the open list asked for: another file asks again.
  const [downloadedFor, setDownloadedFor] = useState<string | null>(null);
  const fileId = version?.file_id;
  const loadDownloaded = useCallback(() => setDownloadedFor(fileId ?? null), [fileId]);
  const signature = detail.effective_subtitle_track_signature;
  // The Auto summary needs the downloaded list when the saved choice is one of its tracks.
  const stored = useStoredSubtitles(
    fileId,
    downloadedFor === fileId || signature?.source === 'downloaded',
  );
  const lists = useMemo(
    () => (version ? subtitleLists(version, stored.data ?? [], lang, t) : NO_SUBTITLES),
    [version, stored.data, lang, t],
  );

  // Where the picks are remembered: the episode's series, else the movie itself.
  const prefKey = trackPrefKey(
    { isEpisode: kind === 'episode', seriesId: detail.series_id },
    detail.content_id,
  );
  // The preferences feed the item's `effective_*` fields: read it again once one is kept.
  const landed = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['detail', 'item'] }),
    [queryClient],
  );
  // An episode that names no series has nothing to remember a pick under: it holds on the page.
  const pending = useRef(new Set<Promise<boolean>>());
  const save = (write: (key: string) => Promise<boolean>) => () => {
    if (prefKey === undefined) return Promise.resolve(true);
    const saving = write(prefKey);
    pending.current.add(saving);
    void saving.then(() => pending.current.delete(saving));
    return saving;
  };
  const whenSaved = useCallback(() => {
    if (pending.current.size === 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SAVE_WAIT_MS);
    });
    const saved = Promise.allSettled([...pending.current]).then(() => undefined);
    return Promise.race([saved, limit]).finally(() => clearTimeout(timer));
  }, []);

  const tracks = version?.audio_tracks ?? NO_TRACKS;
  const autoIndex = version ? autoAudioIndex(version) : 0;
  const audioIndex = audio.shown ?? autoIndex;
  const autoRow = useMemo(() => {
    if (!version) return undefined;
    const settings = subtitleSettings(detail, {
      mode: values['playback.subtitle_mode'],
      language: values['playback.subtitle_language'],
      showForced: values['playback.show_forced_subtitles'],
    });
    const spoken = playingAudioLanguage(
      {
        audioTracks: tracks,
        ...(version.effective_audio_track_index !== undefined
          ? { effectiveAudioIndex: version.effective_audio_track_index }
          : {}),
        ...(version.effective_audio_language
          ? { effectiveAudioLanguage: version.effective_audio_language }
          : {}),
      },
      audioIndex,
    );
    return autoSubtitle(lists, settings, spoken);
  }, [version, detail, values, tracks, audioIndex, lists]);
  const choices = useMemo(
    () => startChoices(version, pickedId !== null, audio.shown, subtitle.shown, lists),
    [version, pickedId, audio.shown, subtitle.shown, lists],
  );

  if (!version) return { version, pills: undefined, choices, whenSaved };

  const audioPill: AudioPill | null =
    tracks.length === 0
      ? null
      : {
          summary:
            audio.shown === null
              ? t('detail.pill.autoSummary', { summary: audioSummary(tracks[autoIndex]!, lang, t) })
              : audioSummary(tracks[audio.shown]!, lang, t),
          autoDescription: audioSummary(tracks[autoIndex]!, lang, t),
          checked: audio.shown,
          rows: audioRows(version, lang, t),
          pick: (index) =>
            audio.choose(
              index,
              save((key) => prefs.audio(key, index, tracks[index]!)),
              landed,
            ),
          reset: () =>
            audio.choose(
              null,
              save((key) => prefs.resetAudio(key)),
              landed,
            ),
        };

  const pills: Pills = {
    version,
    picker: versionPicker(detail, version, t('detail.pill.standardEdition')),
    selectVersion: (fileId) => {
      setPickedId(fileId);
      audio.forget();
      subtitle.forget();
    },
    audio: audioPill,
    subtitles: {
      ...subtitlePill(subtitle.shown, lists, autoRow, signature !== undefined, t),
      lists,
      loading: stored.isLoading,
      load: loadDownloaded,
      pick: (row) =>
        subtitle.choose(
          { mode: 'track', key: row.key },
          save((key) => prefs.subtitle(key, row.item)),
          landed,
        ),
      off: () =>
        subtitle.choose(
          { mode: 'off' },
          save((key) => prefs.subtitle(key, null)),
          landed,
        ),
      reset: () =>
        subtitle.choose(
          AUTO,
          save((key) => prefs.resetSubtitle(key)),
          landed,
        ),
    },
  };
  return { version, pills, choices, whenSaved };
}
