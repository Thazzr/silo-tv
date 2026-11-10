// The pure helpers behind the overlay's facts and the controller's position and track checks.
import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import {
  inRanges,
  mediaFacts,
  plausible,
  previewFacts,
  trackFields,
  type Item,
  type Version,
} from './facts';

function version(overrides: Partial<Version> = {}): Version {
  return {
    fileId: 'file-1',
    trickplay: false,
    chapters: [],
    markers: { marker_segments: [] },
    videoCodec: 'h264',
    resolution: '1080p',
    hdr: false,
    container: 'mp4',
    fileSize: 1000,
    bitrateKbps: 8000,
    audioTracks: [],
    subtitleTracks: [],
    ...overrides,
  };
}

const movie: Item = { isEpisode: false };

describe('plausible', () => {
  it('accepts zero, ordinary positions and the upper bound', () => {
    expect(plausible(0)).toBe(true);
    expect(plausible(1234.5)).toBe(true);
    expect(plausible(1e7)).toBe(true);
  });

  it('rejects negative, non-finite and webOS "unknown" positions', () => {
    expect(plausible(-0.001)).toBe(false);
    expect(plausible(Number.NaN)).toBe(false);
    expect(plausible(Infinity)).toBe(false);
    // INT64_MAX nanoseconds, as seconds
    expect(plausible(9.223372036854776e9)).toBe(false);
    expect(plausible(1e7 + 1)).toBe(false);
  });
});

describe('inRanges', () => {
  const ranges = [
    { start: 0, end: 10 },
    { start: 20, end: 30 },
  ];

  it('holds both ends of a range', () => {
    expect(inRanges(ranges, 0)).toBe(true);
    expect(inRanges(ranges, 10)).toBe(true);
    expect(inRanges(ranges, 20)).toBe(true);
    expect(inRanges(ranges, 30)).toBe(true);
  });

  it('is false in the gap, outside, and for no ranges', () => {
    expect(inRanges(ranges, 15)).toBe(false);
    expect(inRanges(ranges, 30.5)).toBe(false);
    expect(inRanges(ranges, -1)).toBe(false);
    expect(inRanges([], 5)).toBe(false);
  });
});

describe('trackFields', () => {
  it('is empty without a pick', () => {
    expect(trackFields({})).toEqual({});
  });

  it('names the id and the index of each pick separately', () => {
    expect(
      trackFields({ audio: { id: 'a1', index: 2 }, subtitle: { id: 's1', index: 3 } }),
    ).toEqual({
      audio_track_id: 'a1',
      audio_track_index: 2,
      subtitle_track_id: 's1',
      subtitle_track_index: 3,
    });
    expect(trackFields({ audio: { id: 'a1' } })).toEqual({ audio_track_id: 'a1' });
    expect(trackFields({ subtitle: { index: 0 } })).toEqual({ subtitle_track_index: 0 });
  });

  it('keeps a falsy id (0 or empty) on either pick', () => {
    const zero = { id: 0 } as unknown as { id: string };
    expect(trackFields({ subtitle: zero })).toEqual({ subtitle_track_id: 0 });
    expect(trackFields({ audio: { id: '' }, subtitle: { id: '' } })).toEqual({
      audio_track_id: '',
      subtitle_track_id: '',
    });
  });

  it('keeps an index of 0 and drops a pick without fields', () => {
    expect(trackFields({ audio: { index: 0 }, subtitle: {} })).toEqual({ audio_track_index: 0 });
  });
});

describe('mediaFacts', () => {
  const plan = playbackPlan({ effective_media_file_id: 'file-2' });

  it('describes the version the plan plays, not the first one', () => {
    const versions = [
      version({ fileId: 'file-1', videoCodec: 'h264' }),
      version({
        fileId: 'file-2',
        videoCodec: 'hevc',
        resolution: '2160p',
        hdr: true,
        container: 'mkv',
        fileSize: 5000,
        bitrateKbps: 20000,
        edition: 'Director',
        audioTracks: [{ default: true, language: 'en' }],
        subtitleTracks: [
          { default: false, external: false, forced: false, hearing_impaired: false },
        ],
      }),
    ];
    const facts = mediaFacts(plan, versions, { isEpisode: true, seriesId: 'series-1', year: 2020 });
    expect(facts).toMatchObject({
      fileId: 'file-2',
      isEpisode: true,
      seriesId: 'series-1',
      year: 2020,
      videoCodec: 'hevc',
      resolution: '2160p',
      hdr: true,
      container: 'mkv',
      fileSize: 5000,
      bitrateKbps: 20000,
      versionCount: 2,
      edition: 'Director',
    });
    expect(facts.audioTracks).toHaveLength(1);
    expect(facts.subtitleTracks).toHaveLength(1);
  });

  it('leaves out what is empty, but keeps a year of 0', () => {
    const facts = mediaFacts(plan, [version({ fileId: 'file-2', videoCodec: '', fileSize: 0 })], {
      isEpisode: false,
      year: 0,
    });
    expect(facts).not.toHaveProperty('seriesId');
    expect(facts).not.toHaveProperty('videoCodec');
    expect(facts).not.toHaveProperty('fileSize');
    expect(facts).not.toHaveProperty('edition');
    expect(facts.year).toBe(0);
    expect(facts.hdr).toBe(false);
  });

  it('has no version facts and no tracks when the plan names a file the list does not hold', () => {
    const facts = mediaFacts(plan, [version({ fileId: 'file-1', hdr: true })], movie);
    expect(facts.fileId).toBe('file-2');
    expect(facts.hdr).toBe(false);
    expect(facts.audioTracks).toEqual([]);
    expect(facts.subtitleTracks).toEqual([]);
    expect(facts.versionCount).toBe(1);
    expect(facts).not.toHaveProperty('videoCodec');
  });
});

describe('previewFacts', () => {
  const plan = playbackPlan({ effective_media_file_id: 'file-2' });
  const both = { trickplay: true, markerList: true };

  it('reads chapters, trickplay and segments of the exact file the plan plays', () => {
    const chapters = [{ title: 'One', start: 0, end: 60 }];
    const versions = [
      version({
        fileId: 'file-1',
        trickplay: true,
        chapters: [{ title: 'Other', start: 0, end: 5 }],
      }),
      version({
        fileId: 'file-2',
        trickplay: true,
        chapters,
        markers: {
          marker_segments: [
            { kind: 'credits', start_seconds: 100, end_seconds: 120 },
            { kind: 'intro', start_seconds: 5, end_seconds: 30 },
          ],
        },
      }),
    ];
    const facts = previewFacts(plan, versions, both);
    expect(facts.fileId).toBe('file-2');
    expect(facts.trickplay).toBe(true);
    expect(facts.chapters).toEqual(chapters);
    expect(facts.segments).toEqual([
      { kind: 'intro', start: 5, end: 30 },
      { kind: 'credits', start: 100, end: 120 },
    ]);
  });

  it('needs both the server feature and the version for trickplay', () => {
    const versions = [version({ fileId: 'file-2', trickplay: true })];
    expect(previewFacts(plan, versions, { trickplay: false, markerList: true }).trickplay).toBe(
      false,
    );
    expect(
      previewFacts(plan, [version({ fileId: 'file-2', trickplay: false })], both).trickplay,
    ).toBe(false);
  });

  it('reads the singular marker fields when the server has no marker list', () => {
    const versions = [
      version({
        fileId: 'file-2',
        markers: {
          marker_segments: [{ kind: 'credits', start_seconds: 1, end_seconds: 2 }],
          intro: { start_seconds: 3, end_seconds: 9 },
        },
      }),
    ];
    const facts = previewFacts(plan, versions, { trickplay: false, markerList: false });
    expect(facts.segments).toEqual([{ kind: 'intro', start: 3, end: 9 }]);
  });

  it('shows nothing of another version when the plan file is not listed', () => {
    const versions = [
      version({
        fileId: 'file-1',
        trickplay: true,
        chapters: [{ title: 'x', start: 0, end: 1 }],
        markers: { marker_segments: [{ kind: 'intro', start_seconds: 1, end_seconds: 2 }] },
      }),
    ];
    expect(previewFacts(plan, versions, both)).toEqual({
      fileId: 'file-2',
      trickplay: false,
      chapters: [],
      segments: [],
    });
  });
});
