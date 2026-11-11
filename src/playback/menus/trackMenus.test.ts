import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts, S } from '../session/types';
import {
  audioIdentity,
  audioLabel,
  audioRows,
  subtitleLabel,
  subtitleRows,
  tracksForAudioPick,
  tracksForSubtitlePick,
  type InventoryItem,
} from './trackMenus';

const unknown = (n: number) => `Track ${n}`;

const audio = (overrides: Partial<S['WatchAudioTrack']> = {}): S['WatchAudioTrack'] => ({
  default: false,
  ...overrides,
});

const media = (audioTracks: S['WatchAudioTrack'][]): MediaFacts => ({
  fileId: 'file-1',
  isEpisode: false,
  hdr: false,
  audioTracks,
  subtitleTracks: [],
});

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  track_id: 'sub:0',
  combined_index: 0,
  source: 'embedded',
  forced: false,
  default: false,
  hearing_impaired: false,
  delivery: 'sidecar',
  language: 'en',
  ...overrides,
});

describe('audioIdentity', () => {
  it("names the track by the server's address: the plan's file and the audio ordinal", () => {
    const plan = playbackPlan({ effective_media_file_id: 'file-9' });
    expect(audioIdentity(plan, 2)).toEqual({ id: 'file:file-9:audio:2', index: 2 });
  });
});

describe('audioLabel', () => {
  it('joins the language, the codec and the channel layout', () => {
    expect(audioLabel(audio({ language: 'de', codec: 'ac3', channels: 6 }), 0, 'en', unknown)).toBe(
      'German · AC-3 · 5.1',
    );
    expect(
      audioLabel(audio({ language: 'de', codec: 'eac3', layout: 'stereo' }), 0, 'de', unknown),
    ).toBe('Deutsch · E-AC-3 · Stereo');
  });

  it('adds a title that says more than the language and the format', () => {
    const track = audio({
      language: 'en',
      codec: 'aac',
      channels: 2,
      title: "Director's Commentary",
    });
    expect(audioLabel(track, 0, 'en', unknown)).toBe(
      "English · AAC · Stereo · Director's Commentary",
    );
    // "GER - AC3" says nothing new.
    expect(
      audioLabel(audio({ language: 'de', codec: 'ac3', title: 'GER - AC3' }), 0, 'en', unknown),
    ).toBe('German · AC-3');
  });

  it('names a track by its title alone once, when it has no language', () => {
    expect(audioLabel(audio({ title: 'Commentary', codec: 'aac' }), 0, 'en', unknown)).toBe(
      'Commentary · AAC',
    );
  });

  it('numbers a track that names no language and no title', () => {
    expect(audioLabel(audio({ codec: 'aac' }), 1, 'en', unknown)).toBe('Track 2 · AAC');
  });
});

describe('audioRows', () => {
  it("lists the version's tracks in order and checks the one the plan plays", () => {
    const plan = playbackPlan({
      selected_tracks: { audio: { id: 'file:file-1:audio:1', index: 1 } },
    });
    const rows = audioRows(
      plan,
      media([audio({ language: 'en' }), audio({ language: 'de' })]),
      'en',
      unknown,
    );
    expect(rows.map((row) => [row.index, row.label, row.checked])).toEqual([
      [0, 'English', false],
      [1, 'German', true],
    ]);
  });

  it('reads the ordinal from the id when the identity has no index', () => {
    const plan = playbackPlan({ selected_tracks: { audio: { id: 'file:file-1:audio:1' } } });
    const rows = audioRows(plan, media([audio(), audio()]), 'en', unknown);
    expect(rows.map((row) => row.checked)).toEqual([false, true]);
  });

  it('checks nothing when the plan names no audio', () => {
    const plan = playbackPlan({ selected_tracks: {} });
    expect(audioRows(plan, media([audio(), audio()]), 'en', unknown).some((r) => r.checked)).toBe(
      false,
    );
  });
});

describe('subtitleLabel', () => {
  it('names the language and drops a label that is only a file name', () => {
    expect(subtitleLabel(item({ language: 'fr', label: 'Movie.fr.srt' }), 'en', unknown)).toBe(
      'French',
    );
    expect(subtitleLabel(item({ language: 'fr', label: 'French' }), 'de', unknown)).toBe(
      'Französisch',
    );
  });

  it('names a track by its label alone once, when it has no language', () => {
    expect(subtitleLabel(item({ language: '', label: 'Signs only' }), 'en', unknown)).toBe(
      'Signs only',
    );
  });

  it('drops a file-name label that has trailing blanks, and copes with no label at all', () => {
    expect(subtitleLabel(item({ language: 'fr', label: 'Movie.fr.srt ' }), 'en', unknown)).toBe(
      'French',
    );
    expect(subtitleLabel(item({ language: 'fr', label: undefined }), 'en', unknown)).toBe('French');
  });

  it('adds a label that says more, and numbers a track without a language', () => {
    expect(subtitleLabel(item({ language: 'en', label: 'English (Signs)' }), 'en', unknown)).toBe(
      'English · English (Signs)',
    );
    expect(subtitleLabel(item({ language: '', label: '', combined_index: 3 }), 'en', unknown)).toBe(
      'Track 4',
    );
  });
});

describe('subtitleRows', () => {
  const plan = (subtitle?: { id: string; index?: number }) =>
    playbackPlan({
      selected_tracks: {
        audio: { id: 'file:file-1:audio:0', index: 0 },
        ...(subtitle ? { subtitle } : {}),
      },
      subtitle: {
        mode: 'sidecar',
        inventory: [
          item({ track_id: 'sub:0', combined_index: 0, language: 'en' }),
          item({ track_id: 'sub:1', combined_index: 1, language: 'de', forced: true }),
          item({ track_id: 'sub:2', combined_index: 2, language: 'de', hearing_impaired: true }),
        ],
      },
    });

  it('keeps the inventory order, carries the flags and checks the selected track', () => {
    const rows = subtitleRows(plan({ id: 'sub:1', index: 1 }), 'en', unknown);
    expect(
      rows.map((row) => [
        row.item.track_id,
        row.label,
        row.forced,
        row.hearingImpaired,
        row.checked,
      ]),
    ).toEqual([
      ['sub:0', 'English', false, false, false],
      ['sub:1', 'German', true, false, true],
      ['sub:2', 'German', false, true, false],
    ]);
  });

  it('checks no row when the plan plays no subtitle', () => {
    expect(subtitleRows(plan(), 'en', unknown).some((row) => row.checked)).toBe(false);
  });
});

describe('the tracks a pick names', () => {
  const current = () =>
    playbackPlan({
      selected_tracks: {
        audio: { id: 'file:file-1:audio:0', index: 0 },
        subtitle: { id: 'sub:1', index: 1 },
      },
    });

  it('an audio pick names the new audio and keeps the subtitle the plan plays', () => {
    expect(tracksForAudioPick(current(), 2)).toEqual({
      audio: { id: 'file:file-1:audio:2', index: 2 },
      subtitle: { id: 'sub:1', index: 1 },
    });
  });

  it('an audio pick sends no subtitle when the plan plays none (that means off)', () => {
    const plan = playbackPlan({
      selected_tracks: { audio: { id: 'file:file-1:audio:0', index: 0 } },
    });
    expect(tracksForAudioPick(plan, 1)).toEqual({ audio: { id: 'file:file-1:audio:1', index: 1 } });
  });

  it('a subtitle pick names the track by id and combined index and keeps the audio', () => {
    expect(
      tracksForSubtitlePick(current(), item({ track_id: 'sub:7', combined_index: 4 })),
    ).toEqual({
      audio: { id: 'file:file-1:audio:0', index: 0 },
      subtitle: { id: 'sub:7', index: 4 },
    });
  });

  it('Off sends the current audio and no subtitle member', () => {
    const tracks = tracksForSubtitlePick(current(), null);
    expect(tracks).toEqual({ audio: { id: 'file:file-1:audio:0', index: 0 } });
    expect('subtitle' in tracks).toBe(false);
  });
});
