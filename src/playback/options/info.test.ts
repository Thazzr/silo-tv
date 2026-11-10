import { describe, expect, it } from 'vitest';
import { playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts } from '../usePlaybackSession';
import { audioText, channelText, currentChapter, routeOf, subtitleText, videoText } from './info';

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

describe('videoText', () => {
  it('joins codec, resolution and HDR as far as they are known', () => {
    const plan = playbackPlan();
    expect(videoText(plan, media({ resolution: '2160p', hdr: true }))).toBe('H264 · 2160p · HDR');
    expect(videoText(plan, media())).toBe('H264');
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
