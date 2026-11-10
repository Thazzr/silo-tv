import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts } from '../session/types';
import {
  conversions,
  currentChapter,
  dynamicRangeName,
  informativeTitle,
  episodeCode,
  reasonsOf,
  routeOf,
  selectedAudio,
  streamKind,
  subtitleChoice,
} from './info';

const media = (overrides: Partial<MediaFacts> = {}): MediaFacts => ({
  fileId: 'file-1',
  isEpisode: false,
  hdr: false,
  audioTracks: [],
  subtitleTracks: [],
  ...overrides,
});

describe('routeOf', () => {
  it.each([
    ['original_http', 'direct'],
    ['server_remux_progressive', 'remux'],
    ['server_remux_hls', 'remux'],
    ['server_transcode_hls', 'transcode'],
    ['something_new', null],
  ])('%s is %s', (delivery, route) => {
    expect(routeOf(delivery)).toBe(route);
  });
});

describe('subtitleChoice', () => {
  it('is null (off) when the plan selects no subtitle', () => {
    expect(subtitleChoice(playbackPlan(), media(), 'en')).toBeNull();
  });

  it('names the label of the inventory item, else the track list (a bare language as its name), else only "on"', () => {
    const inventory = {
      combined_index: 0,
      default: false,
      delivery: 'sidecar',
      forced: false,
      hearing_impaired: false,
      source: 'embedded',
      track_id: 'file:1:subtitle:0',
      label: 'English (SDH)',
    };
    const selected = { id: 'file:1:subtitle:0', index: 0 };
    const withInventory = playbackPlan({
      selected_tracks: { subtitle: selected },
      subtitle: { inventory: [inventory], mode: 'sidecar' },
    });
    expect(subtitleChoice(withInventory, media(), 'en')).toEqual({ label: 'English (SDH)' });
    const listed = playbackPlan({ selected_tracks: { subtitle: selected } });
    expect(
      subtitleChoice(
        listed,
        media({
          subtitleTracks: [
            {
              default: false,
              external: false,
              forced: false,
              hearing_impaired: false,
              index: 0,
              language: 'de',
            },
          ],
        }),
        'en',
      ),
    ).toEqual({ label: 'German' });
    expect(subtitleChoice(listed, media(), 'en')).toEqual({ label: null });
  });

  it('prefers the inventory label over the listed title when both exist', () => {
    const plan = playbackPlan({
      selected_tracks: { subtitle: { id: 'file:1:subtitle:0', index: 0 } },
      subtitle: {
        inventory: [
          {
            combined_index: 0,
            default: false,
            delivery: 'sidecar',
            forced: false,
            hearing_impaired: false,
            source: 'embedded',
            track_id: 'file:1:subtitle:0',
            label: 'Inventory label',
          },
        ],
        mode: 'sidecar',
      },
    });
    const withTitle = media({
      subtitleTracks: [
        {
          default: false,
          external: false,
          forced: false,
          hearing_impaired: false,
          index: 0,
          title: 'Listed title',
          language: 'de',
        },
      ],
    });
    expect(subtitleChoice(plan, withTitle, 'en')).toEqual({ label: 'Inventory label' });
  });
});

describe('episodeCode', () => {
  it('words the numbers as "S1 · E2", and is null without any', () => {
    expect(episodeCode({ title: 'x', seasonNumber: 1, episodeNumber: 2 })).toBe('S1 · E2');
    expect(episodeCode({ title: 'x', episodeNumber: 2 })).toBe('E2');
    // Specials are season 0 and episode 0: no truthiness check may drop them.
    expect(episodeCode({ title: 'x', seasonNumber: 0, episodeNumber: 0 })).toBe('S0 · E0');
    expect(episodeCode({ title: 'x', seasonNumber: 0 })).toBe('S0');
    expect(episodeCode({ title: 'x' })).toBeNull();
    expect(episodeCode(null)).toBeNull();
  });
});

describe('currentChapter', () => {
  const chapters = [
    { title: 'A', start: 0, end: 100 },
    { title: 'B', start: 100, end: 200 },
  ];
  it('is the last chapter whose start has passed, or -1 before the first', () => {
    expect(currentChapter(chapters, 0)).toBe(0);
    expect(currentChapter(chapters, 99.9)).toBe(0);
    expect(currentChapter(chapters, 100)).toBe(1);
    expect(currentChapter([{ title: 'X', start: 5, end: 9 }], 1)).toBe(-1);
    expect(currentChapter([], 10)).toBe(-1);
  });
});

describe('selectedAudio', () => {
  const tracks = [
    { default: true, language: 'en', codec: 'eac3', channels: 6 },
    { default: false, language: 'de', codec: 'aac', channels: 2 },
  ];

  it('is the listed track the plan plays, by index or by the number at the end of its id', () => {
    const byIndex = playbackPlan({
      selected_tracks: { audio: { id: 'file:1:audio:0', index: 1 } },
    });
    expect(selectedAudio(byIndex, media({ audioTracks: tracks }))?.language).toBe('de');
    const byId = playbackPlan({ selected_tracks: { audio: { id: 'file:1:audio:0' } } });
    expect(selectedAudio(byId, media({ audioTracks: tracks }))?.language).toBe('en');
  });

  it('is undefined when no list describes the track', () => {
    expect(selectedAudio(playbackPlan(), media())).toBeUndefined();
    const none = playbackPlan({ selected_tracks: {} });
    expect(selectedAudio(none, media({ audioTracks: tracks }))).toBeUndefined();
  });
});

describe('streamKind', () => {
  const hls = {
    container: 'mp4',
    header_refresh: 'none',
    headers: {},
    protocol: 'hls',
    url: '/x.m3u8',
  };
  const recipe = (segment_container?: string) => ({ video_codec: 'h264', segment_container });

  it('is a file for a progressive stream', () => {
    expect(streamKind(playbackPlan())).toBe('file');
  });

  it('is HLS in TS segments or in fMP4 as the recipe says, and plain HLS when it does not', () => {
    expect(streamKind(playbackPlan({ stream: hls, effective_recipe: recipe('mpegts') }))).toBe(
      'hlsTs',
    );
    expect(streamKind(playbackPlan({ stream: hls, effective_recipe: recipe('fmp4') }))).toBe(
      'hlsFmp4',
    );
    expect(streamKind(playbackPlan({ stream: hls, effective_recipe: recipe() }))).toBe('hls');
    // `mp4` and `ts` are other names for the same two packagings.
    expect(streamKind(playbackPlan({ stream: hls, effective_recipe: recipe('mp4') }))).toBe(
      'hlsFmp4',
    );
    expect(streamKind(playbackPlan({ stream: hls, effective_recipe: recipe('ts') }))).toBe('hlsTs');
  });

  it('takes an HLS mime type for HLS as well', () => {
    const stream = { ...hls, protocol: 'http', mime_type: 'application/vnd.apple.mpegurl' };
    expect(streamKind(playbackPlan({ stream }))).toBe('hls');
  });
});

const transformation = (name: string) => ({
  name,
  executor: 'server',
  recipe_version: '1',
  validated_claims: [],
});

describe('reasonsOf', () => {
  const reason = (decision_reason: string, names: string[] = []) =>
    reasonsOf(playbackPlan({ decision_reason, transformations: names.map(transformation) }));

  it.each([
    ['validated_original_playback', 'direct'],
    ['container_normalization', 'container'],
    ['audio_adaptation', 'audio'],
    ['hls_audio_adaptation', 'audio'],
    ['hls_packaging_required', 'packaging'],
    ['subtitle_burn_in_required', 'burnIn'],
    ['client_dv7_to_dv81', 'dolbyVision'],
    ['client_dv7_to_hdr10', 'dolbyVision'],
    ['client_managed_dynamic_range', 'managedRange'],
    ['client_dv8_base_layer', 'dolbyBase'],
    ['evidence_insufficient_for_direct', 'noEvidence'],
    ['quality_auto_source', 'qualityAuto'],
    ['quality_fixed_rung', 'quality'],
    ['quality_device_limit', 'qualityDevice'],
    ['quality_bandwidth_limit', 'qualityBandwidth'],
    ['quality_bandwidth_cap', 'qualityCap'],
    ['quality_original', 'qualityOriginal'],
  ])('maps the documented reason %s to %s', (decision, id) => {
    expect(reason(decision)).toEqual([id]);
  });

  it('says nothing for a reason it does not know, rather than the raw code', () => {
    expect(reason('some_future_reason')).toEqual([]);
  });

  it('adds what the transformations convert, once', () => {
    expect(reason('validated_original_playback', ['audio_to_aac'])).toEqual(['direct', 'audio']);
    expect(reason('audio_adaptation', ['audio_to_aac'])).toEqual(['audio']);
    expect(reason('hls_packaging_required', ['video_to_h264'])).toEqual(['packaging', 'video']);
    expect(reason('some_future_reason', ['video_to_hevc', 'audio_to_aac'])).toEqual([
      'video',
      'audio',
    ]);
  });

  it('leaves "video is converted" out of a chosen quality, which says so already', () => {
    expect(reason('quality_fixed_rung', ['video_to_h264'])).toEqual(['quality']);
  });
});

describe('conversions', () => {
  const base = playbackPlan();

  it('is direct for a plan that plays the file as it is', () => {
    expect(conversions(base)).toEqual({ video: false, audio: false });
  });

  it('converts the audio for an audio transformation, another codec or fewer channels', () => {
    const named = playbackPlan({ transformations: [transformation('audio_to_aac')] });
    expect(conversions(named)).toEqual({ video: false, audio: true });
    const codec = playbackPlan({ effective_recipe: { video_codec: 'h264', audio_codec: 'ac3' } });
    expect(conversions(codec).audio).toBe(true);
    const channels = playbackPlan({
      effective_recipe: { video_codec: 'h264', audio_codec: 'aac', audio_channels: 2 },
      source: { ...base.source, audio_channels: 6 },
    });
    expect(conversions(channels).audio).toBe(true);
  });

  it('converts the video for a transcode, a video transformation, another codec or a lower height', () => {
    expect(conversions(playbackPlan({ delivery: 'server_transcode_hls' })).video).toBe(true);
    const named = playbackPlan({ transformations: [transformation('video_to_h264')] });
    expect(conversions(named).video).toBe(true);
    const codec = playbackPlan({
      effective_recipe: { video_codec: 'h264' },
      source: { ...base.source, video_codec: 'hevc' },
    });
    expect(conversions(codec).video).toBe(true);
    const scaled = playbackPlan({
      effective_recipe: { video_codec: 'h264', height: 720 },
      source: { ...base.source, height: 1080 },
    });
    expect(conversions(scaled).video).toBe(true);
  });

  it('keeps a remux direct', () => {
    expect(conversions(playbackPlan({ delivery: 'server_remux_hls' }))).toEqual({
      video: false,
      audio: false,
    });
  });
});

describe('dynamicRangeName', () => {
  const source = (extra: Partial<ReturnType<typeof playbackPlan>['source']>) => ({
    ...playbackPlan().source,
    ...extra,
  });

  it('writes Dolby Vision with its profile and level', () => {
    const dv = (extra: object) =>
      dynamicRangeName(source({ dolby_vision_profile: 8, ...extra }), true);
    expect(dv({ dv_bl_compat_id: 1 })).toBe('Dolby Vision 8.1');
    expect(dv({ dv_bl_compat_id: 4 })).toBe('Dolby Vision 8.4');
    // The level is left out; without a compatibility id only the profile shows.
    expect(dv({ dv_bl_compat_id: 1, dolby_vision_level: 6 })).toBe('Dolby Vision 8.1');
    expect(dv({ dolby_vision_level: 6 })).toBe('Dolby Vision 8');
    expect(dynamicRangeName(source({ dolby_vision_profile: 5 }), true)).toBe('Dolby Vision 5');
  });

  it('knows HDR10+, HDR10, HLG and SDR', () => {
    expect(dynamicRangeName(source({ hdr10_plus: true, dynamic_range: 'hdr10' }), true)).toBe(
      'HDR10+',
    );
    expect(dynamicRangeName(source({ dynamic_range: 'HDR10Plus' }), true)).toBe('HDR10+');
    expect(dynamicRangeName(source({ dynamic_range: 'hdr10' }), true)).toBe('HDR10');
    expect(dynamicRangeName(source({ dynamic_range: 'hlg' }), true)).toBe('HLG');
    expect(dynamicRangeName(source({ dynamic_range: 'sdr' }), false)).toBe('SDR');
  });

  it("falls back on the file's HDR flag when the range is not named", () => {
    expect(dynamicRangeName(source({}), true)).toBe('HDR');
    expect(dynamicRangeName(source({ dynamic_range: 'something_new' }), false)).toBe('SDR');
  });
});

describe('informativeTitle', () => {
  it.each([
    'GER - AC3',
    'AC3 5.1',
    'Deutsch',
    'English Stereo',
    'DTS-HD 7.1',
    'Surround',
    'E-AC-3 · 5.1',
    '',
  ])('leaves out %j, which only repeats the language, codec or channels', (title) => {
    expect(informativeTitle(title)).toBeNull();
  });

  it.each(['Kommentar', "Director's Commentary", 'GER - Audiodeskription', 'Commentary 5.1'])(
    'keeps %j, which says more',
    (title) => {
      expect(informativeTitle(title)).toBe(title);
    },
  );

  it('leaves out a mono title and titles joined by commas, slashes or dots', () => {
    for (const title of ['Mono', 'GER, AC3', 'GER/AC3', 'DE · AC3']) {
      expect(informativeTitle(title), title).toBeNull();
    }
  });

  it('returns the trimmed text of a title that says more', () => {
    expect(informativeTitle("  Director's Commentary  ")).toBe("Director's Commentary");
  });

  it('is null for a missing title', () => {
    expect(informativeTitle(undefined)).toBeNull();
    expect(informativeTitle(null)).toBeNull();
  });
});
