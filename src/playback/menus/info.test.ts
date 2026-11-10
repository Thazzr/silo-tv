import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts } from '../usePlaybackSession';
import {
  audioText,
  channelText,
  currentChapter,
  episodeCode,
  routeOf,
  sourceFacts,
  streamType,
  subtitleText,
  videoCodecText,
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

describe('channelText', () => {
  it.each([
    [6, '5.1'],
    [8, '7.1'],
    [2, '2.0'],
    [1, '1.0'],
    [3, '3 ch'],
    [0, null],
    [undefined, null],
  ])('%s channels read %s', (channels, text) => {
    expect(channelText(channels)).toBe(text);
  });
});

describe('audioText', () => {
  const tracks = [
    { default: true, language: 'en', codec: 'eac3', channels: 6 },
    { default: false, language: 'und', title: 'Commentary', codec: 'aac', channels: 2 },
  ];

  it('names language, codec and channels of the selected track', () => {
    const plan = playbackPlan({ selected_tracks: { audio: { id: 'file:1:audio:0', index: 0 } } });
    expect(audioText(plan, media({ audioTracks: tracks }))).toBe('en · EAC3 · 5.1');
  });

  it('falls back to the title for an undetermined language, and to the id for the index', () => {
    const plan = playbackPlan({ selected_tracks: { audio: { id: 'file:1:audio:1' } } });
    expect(audioText(plan, media({ audioTracks: tracks }))).toBe('Commentary · AAC · 2.0');
  });

  it('is null when no list describes the track', () => {
    expect(audioText(playbackPlan(), media())).toBeNull();
  });
});

describe('subtitleText', () => {
  it('is null (off) when the plan selects no subtitle', () => {
    expect(subtitleText(playbackPlan(), media())).toBeNull();
  });

  it('names the label of the inventory item, else the track list, else only "on"', () => {
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
    expect(subtitleText(withInventory, media())).toEqual({ label: 'English (SDH)' });
    const listed = playbackPlan({ selected_tracks: { subtitle: selected } });
    expect(
      subtitleText(
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
      ),
    ).toEqual({ label: 'de' });
    expect(subtitleText(listed, media())).toEqual({ label: null });
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
    expect(subtitleText(plan, withTitle)).toEqual({ label: 'Inventory label' });
  });
});

describe('videoCodecText', () => {
  it('is the codec in capitals, from the recipe, else the media facts, else the source', () => {
    const plan = playbackPlan();
    expect(videoCodecText(plan, media())).toBe('H264');
    const noRecipe = { ...plan, effective_recipe: {} };
    expect(videoCodecText(noRecipe, media({ videoCodec: 'hevc' }))).toBe('HEVC');
    expect(videoCodecText(noRecipe, media())).toBe('H264');
    expect(
      videoCodecText(
        { ...plan, effective_recipe: { ...plan.effective_recipe, video_codec: 'av1' } },
        media(),
      ),
    ).toBe('AV1');
    expect(
      videoCodecText(
        { ...plan, effective_recipe: {}, source: { ...plan.source, video_codec: undefined } },
        media(),
      ),
    ).toBeNull();
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

describe('streamType', () => {
  it('is progressive for a direct play and HLS for everything else', () => {
    expect(streamType('direct')).toBe('progressive');
    expect(streamType('remux')).toBe('hls');
    expect(streamType('transcode')).toBe('hls');
    expect(streamType(null)).toBe('hls');
  });
});

describe('sourceFacts', () => {
  it('names the container, the resolution and the dynamic range as far as known', () => {
    const plan = playbackPlan();
    expect(sourceFacts(plan, media({ resolution: '2160p', hdr: true }))).toEqual({
      container: 'MP4',
      resolution: '2160p',
      hdr: true,
    });
    // The watch data's resolution wins over the plan's height.
    const tall = { ...plan, source: { ...plan.source, height: 720 } };
    expect(sourceFacts(tall, media({ resolution: '1080p' })).resolution).toBe('1080p');
    expect(sourceFacts(tall, media()).resolution).toBe('720p');
    // The container is trimmed, and a blank one is unknown.
    const padded = { ...plan, source: { ...plan.source, container: '  mkv ' } };
    expect(sourceFacts(padded, media()).container).toBe('MKV');
    const blank = { ...plan, source: { ...plan.source, container: '   ' } };
    expect(sourceFacts(blank, media()).container).toBeNull();
    const bare = { ...plan, source: { ...plan.source, container: undefined, height: 720 } };
    expect(sourceFacts(bare, media())).toEqual({ container: null, resolution: '720p', hdr: false });
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
