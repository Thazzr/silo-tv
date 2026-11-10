// The info panel on its own: what it says for a direct play, a remux and a transcode, how it writes
// numbers in each language, and how its live readings follow the engine and the element.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translate, type Language } from '../../i18n';
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';
import { FakeEngine } from '../../test/fakeEngine';
import { fakeVideo, installFakeMedia } from '../../test/fakeVideo';
import { ACCESS_TOKEN, playbackPlan } from '../../test/playbackFixtures';
import type { MediaFacts, MediaFailure, Plan } from '../session/types';
import { InfoColumn } from './InfoColumn';

const media = (overrides: Partial<MediaFacts> = {}): MediaFacts => ({
  fileId: 'file-1',
  isEpisode: false,
  hdr: false,
  audioTracks: [],
  subtitleTracks: [],
  ...overrides,
});

let restoreMedia: () => void;
beforeEach(() => {
  restoreMedia = installFakeMedia();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreMedia();
});

function videoOfSize(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video');
  const state = fakeVideo(video);
  state.videoWidth = width;
  state.videoHeight = height;
  return video;
}

interface Options {
  plan?: Plan;
  media?: MediaFacts;
  video?: HTMLVideoElement | null;
  engine?: FakeEngine | null;
  lang?: Language;
  qualityName?: string | null;
  mediaError?: MediaFailure | null;
  secrets?: readonly (string | undefined)[];
}

const column = (options: Options = {}) => (
  <I18nProvider lang={options.lang ?? 'en'}>
    <InfoColumn
      plan={options.plan ?? playbackPlan()}
      media={options.media ?? media()}
      video={options.video === undefined ? videoOfSize(1920, 1080) : options.video}
      engine={options.engine === undefined ? new FakeEngine() : options.engine}
      qualityName={options.qualityName}
      mediaError={options.mediaError}
      secrets={options.secrets}
    />
  </I18nProvider>
);

const info = () => screen.getByTestId('player-info');
const now = () => within(screen.getByTestId('player-info-now'));
const source = () => within(screen.getByTestId('player-info-source'));
const footer = () =>
  within(screen.queryByTestId('player-info-footer') ?? document.createElement('div'));

/** The value next to `label` inside `scope`, or null when there is no such row. */
function value(scope: ReturnType<typeof within>, label: string, at = 0): string | null {
  const labels = scope.queryAllByText(label, { selector: 'dt' });
  return labels[at]?.nextElementSibling?.textContent ?? null;
}

const HLS_STREAM = {
  container: 'mp4',
  header_refresh: 'none',
  headers: {},
  protocol: 'hls',
  url: '/api/v2/stream/s1/index.m3u8?st=signed-1',
};
const transformation = (name: string) => ({
  name,
  executor: 'server',
  recipe_version: '1',
  validated_claims: [],
});

describe('the info panel: what plays now', () => {
  it('says direct play, plainly, for a file played as it is', () => {
    render(column({ engine: new FakeEngine() }));
    expect(value(now(), 'Type')).toBe('Direct play');
    expect(value(now(), 'Reason')).toBe('Plays directly');
    expect(value(now(), 'Player')).toBe('Built-in');
    expect(value(now(), 'Stream')).toBe('File (progressive)');
    expect(value(now(), 'Picture')).toBe('1920×1080');
    expect(value(now(), 'Codec', 0)).toBe('H.264 · direct');
    expect(value(now(), 'Codec', 1)).toBe('AAC · direct');
  });

  it('names a transcode: the chosen quality, hls.js, TS segments, what is converted and its bitrate', () => {
    const engine = new FakeEngine();
    engine.decoder = 'hlsjs';
    const plan = playbackPlan({
      delivery: 'server_transcode_hls',
      decision_reason: 'quality_fixed_rung',
      stream: HLS_STREAM,
      effective_recipe: {
        video_codec: 'h264',
        audio_codec: 'aac',
        audio_channels: 2,
        bitrate_kbps: 4000,
        frame_rate: 23.976,
        segment_container: 'mpegts',
      },
      transformations: [transformation('video_to_h264'), transformation('audio_to_aac')],
    });
    render(column({ plan, engine, qualityName: '720p High' }));
    expect(value(now(), 'Type')).toBe('Transcode');
    expect(value(now(), 'Reason')).toBe('Quality chosen: 720p High · Audio is converted');
    expect(value(now(), 'Player')).toBe('hls.js (MSE)');
    expect(value(now(), 'Stream')).toBe('HLS · TS segments');
    expect(value(now(), 'Picture')).toBe('1920×1080 · 23.976 fps');
    expect(value(now(), 'Codec', 0)).toBe('H.264 · converted');
    expect(value(now(), 'Bitrate')).toBe('4 Mbit/s');
  });

  it('names a remux in fragmented MP4, and says the container is repackaged', () => {
    const plan = playbackPlan({
      delivery: 'server_remux_hls',
      decision_reason: 'container_normalization',
      stream: HLS_STREAM,
      effective_recipe: { video_codec: 'h264', audio_codec: 'aac', segment_container: 'fmp4' },
    });
    render(column({ plan }));
    expect(value(now(), 'Type')).toBe('Remux');
    expect(value(now(), 'Reason')).toBe('Container is repackaged');
    expect(value(now(), 'Stream')).toBe('HLS · fMP4');
    expect(value(now(), 'Codec', 0)).toBe('H.264 · direct');
  });

  it('leaves the reason out for a value it does not know, and shows no raw code', () => {
    render(column({ plan: playbackPlan({ decision_reason: 'brand_new_reason' }) }));
    expect(value(now(), 'Reason')).toBeNull();
    expect(info()).not.toHaveTextContent('brand_new_reason');
  });

  it('names the audio track by its language, and lists the title next to it', () => {
    const tracks = [
      {
        default: true,
        language: 'de',
        title: 'Surround',
        codec: 'eac3',
        channels: 6,
        layout: '5.1(side)',
      },
    ];
    const plan = playbackPlan({
      effective_recipe: { video_codec: 'h264', audio_codec: 'eac3', audio_channels: 6 },
      source: { ...playbackPlan().source, audio_codec: 'eac3', audio_channels: 6 },
    });
    render(column({ plan, media: media({ audioTracks: tracks }) }));
    // The title only names channels: the language alone, the codec has its own row.
    expect(value(now(), 'Track', 0)).toBe('German');
    expect(value(now(), 'Codec', 1)).toBe('E-AC-3 · 5.1 · direct');
  });

  it('adds a track title that says more than language, codec and channels', () => {
    const track = (title: string) => [
      { default: true, language: 'de', title, codec: 'ac3', channels: 6 },
    ];
    render(column({ media: media({ audioTracks: track('GER - AC3') }) }));
    expect(value(now(), 'Track', 0)).toBe('German');
    cleanup();
    render(column({ media: media({ audioTracks: track("Director's Commentary") }) }));
    expect(value(now(), 'Track', 0)).toBe("German · Director's Commentary");
  });

  it('writes the language and the track title in the app language, an undetermined one as its title', () => {
    const tracks = [{ default: true, language: 'und', title: 'Commentary', codec: 'aac' }];
    render(column({ media: media({ audioTracks: tracks }) }));
    expect(value(now(), 'Track', 0)).toBe('Commentary');
    cleanup();
    render(
      column({
        lang: 'de',
        media: media({ audioTracks: [{ default: true, language: 'fr', codec: 'aac' }] }),
      }),
    );
    expect(value(now(), 'Spur', 0)).toBe('Französisch');
  });

  it('says Off for no subtitle, and names the language for a selected one', () => {
    render(column());
    expect(within(info()).getByText('Subtitles').nextElementSibling).toHaveTextContent('Off');
    cleanup();
    const plan = playbackPlan({
      selected_tracks: { subtitle: { id: 'file:1:subtitle:0', index: 0 } },
    });
    render(
      column({
        plan,
        media: media({
          subtitleTracks: [
            {
              default: false,
              external: false,
              forced: false,
              hearing_impaired: false,
              index: 0,
              language: 'ja',
            },
          ],
        }),
      }),
    );
    expect(within(info()).getByText('Subtitles').nextElementSibling).toHaveTextContent('Japanese');
  });
});

describe('the info panel: the source file', () => {
  const version = media({
    container: 'mkv',
    fileSize: 4.2 * 1024 ** 3,
    bitrateKbps: 8450,
    versionCount: 1,
    resolution: '1080p',
    audioTracks: [
      {
        default: true,
        language: 'en',
        codec: 'eac3',
        channels: 6,
        layout: '5.1(side)',
        bitrate: 640,
        sample_rate: 48000,
      },
    ],
  });
  const plan = playbackPlan({
    source: {
      ...playbackPlan().source,
      container: 'matroska',
      video_codec: 'hevc',
      video_profile: 'Main 10',
      bit_depth: 10,
      width: 3840,
      height: 2160,
      frame_rate: 23.976,
      dynamic_range: 'hdr10',
    },
  });

  it('describes the file: container and size, bitrate, video and the chosen audio track', () => {
    render(column({ plan, media: version }));
    expect(value(source(), 'Container')).toBe('MKV · 4.2 GB');
    expect(value(source(), 'Bitrate', 0)).toBe('8.5 Mbit/s');
    expect(value(source(), 'Codec')).toBe('HEVC Main 10 · 10-bit');
    expect(value(source(), 'Picture')).toBe('3840×2160 · 23.976 fps');
    expect(value(source(), 'Dynamic range')).toBe('HDR10');
    expect(value(source(), 'Track')).toBe('English · E-AC-3 · 5.1');
    expect(value(source(), 'Bitrate', 1)).toBe('640 kbit/s · 48 kHz');
  });

  it('capitalises the profile name of the source video', () => {
    const lower = playbackPlan({
      source: { ...plan.source, video_codec: 'h264', video_profile: 'high', bit_depth: 8 },
    });
    render(column({ plan: lower, media: version }));
    expect(value(source(), 'Codec')).toBe('H.264 High · 8-bit');
  });

  it('writes the profile and level of Dolby Vision', () => {
    const dv = playbackPlan({
      source: {
        ...plan.source,
        dolby_vision_profile: 8,
        dv_bl_compat_id: 1,
        dolby_vision_level: 6,
      },
    });
    render(column({ plan: dv, media: version }));
    // Profile and base-layer compatibility id; the level stays out.
    expect(value(source(), 'Dynamic range')).toBe('Dolby Vision 8.1');
  });

  it('shows the version only when the title has several, as its edition or else its resolution', () => {
    render(column({ plan, media: version }));
    expect(value(source(), 'Version')).toBeNull();
    cleanup();
    render(column({ plan, media: { ...version, versionCount: 2 } }));
    expect(value(source(), 'Version')).toBe('1080p');
    cleanup();
    render(column({ plan, media: { ...version, versionCount: 2, edition: "Director's Cut" } }));
    expect(value(source(), 'Version')).toBe("Director's Cut");
  });

  it('writes numbers with the decimal comma in German', () => {
    const engine = new FakeEngine();
    engine.decoder = 'hlsjs';
    engine.bandwidthEstimate = 12_500_000;
    render(column({ plan, media: version, lang: 'de', engine }));
    expect(value(source(), 'Container')).toBe('MKV · 4,2 GB');
    expect(value(source(), 'Bitrate', 0)).toBe('8,5 Mbit/s');
    expect(value(source(), 'Bild')).toBe('3840×2160 · 23,976 fps');
    expect(value(source(), 'Codec')).toBe('HEVC Main 10 · 10 Bit');
    expect(value(now(), 'Bandbreite')).toBe('12,5 Mbit/s');
    expect(within(info()).getByText('Jetzt')).toBeInTheDocument();
    expect(within(info()).getByText('Quelldatei')).toBeInTheDocument();
  });

  it('never shows a path, a file name, a URL or a token', () => {
    const secretPlan = playbackPlan({
      stream: { ...HLS_STREAM, url: `/api/v2/stream/s1/index.m3u8?token=${ACCESS_TOKEN}` },
    });
    render(column({ plan: secretPlan, media: version }));
    const text = info().textContent ?? '';
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain('/api/v2/stream');
    expect(text).not.toContain('index.m3u8');
    expect(text).not.toMatch(/https?:\/\//);
    expect(info().innerHTML).not.toContain('file_path');
    expect(info().innerHTML).not.toContain('file_name');
  });
});

describe('the info panel: the connection', () => {
  it('shows the buffer ahead, the dropped frames and, on hls.js only, the bandwidth', () => {
    const video = videoOfSize(1920, 1080);
    video.getVideoPlaybackQuality = () =>
      ({ droppedVideoFrames: 0, totalVideoFrames: 972 }) as VideoPlaybackQuality;
    const engine = new FakeEngine();
    engine.currentTime = 100;
    engine.buffered = [{ start: 40, end: 138.4 }];
    engine.bandwidthEstimate = 8_000_000;
    render(column({ video, engine }));
    expect(value(now(), 'Buffer')).toBe('38 s ahead');
    expect(value(now(), 'Frames')).toBe('0 of 972 dropped');
    // The estimate belongs to hls.js; the native player has none to show.
    expect(value(now(), 'Bandwidth')).toBeNull();
    cleanup();
    engine.decoder = 'hlsjs';
    render(column({ video, engine }));
    expect(value(now(), 'Bandwidth')).toBe('8 Mbit/s');
  });

  it('leaves out the frames without the API, the buffer without data, and the bandwidth before a reading', () => {
    const engine = new FakeEngine();
    engine.decoder = 'hlsjs';
    render(column({ engine }));
    expect(value(now(), 'Frames')).toBeNull();
    expect(value(now(), 'Buffer')).toBeNull();
    expect(value(now(), 'Bandwidth')).toBeNull();
    expect(within(info()).queryByText('Connection')).toBeNull();
  });

  it('shows a bandwidth limit and the degradation warnings only when the plan has them', () => {
    render(column());
    expect(value(footer(), 'Limit')).toBeNull();
    expect(value(footer(), 'Notice')).toBeNull();
    cleanup();
    const plan = playbackPlan({
      bandwidth_limit: {
        kbps: 4000,
        source: 'observed_rebuffer',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
      degradation_warnings: [{ code: 'hdr_range_assumed_hdr10', message: 'HDR range assumed.' }],
    });
    render(column({ plan }));
    expect(value(footer(), 'Limit')).toBe('Limited to 4 Mbit/s (after stalls)');
    expect(value(footer(), 'Notice')).toBe('Source range unknown, treated as HDR10');
  });

  it('puts the conditional rows in a footer inside the right column, under the source-file facts', () => {
    const plan = playbackPlan({
      bandwidth_limit: {
        kbps: 4000,
        source: 'observed_rebuffer',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
      degradation_warnings: [{ code: 'audio_converted', message: 'Audio was re-encoded.' }],
    });
    render(column({ plan, mediaError: { code: 3, message: 'DECODE' } }));
    const footer = screen.getByTestId('player-info-footer');
    expect(footer.parentElement).toBe(screen.getByTestId('player-info-source'));
    expect(screen.getByTestId('player-info-source').lastElementChild).toBe(footer);
    // Not a third child of the panel, and not in the left column.
    expect(footer.parentElement).not.toBe(info());
    expect(screen.getByTestId('player-info-now')).not.toContainElement(footer);
    expect(info().children).toHaveLength(2);
    expect(within(footer).getByText('Limit')).toBeInTheDocument();
    expect(within(footer).getByText('Notice')).toBeInTheDocument();
    expect(within(footer).getByText('Last media error')).toBeInTheDocument();
    // None of them is in a column any more.
    expect(value(now(), 'Limit')).toBeNull();
    expect(value(now(), 'Notice')).toBeNull();
    expect(value(now(), 'Last media error')).toBeNull();
  });

  it('adds no row for a warning whose text is blank, and no footer for blank ones alone', () => {
    const plan = playbackPlan({
      degradation_warnings: [{ code: 'brand_new_warning', message: '   ' }],
    });
    render(column({ plan }));
    expect(screen.queryByTestId('player-info-footer')).toBeNull();
    expect(within(info()).queryByText('Notice')).toBeNull();
  });

  it('hides the access token and the media URL inside a server warning message', () => {
    const plan = playbackPlan({
      degradation_warnings: [
        {
          code: 'brand_new_warning',
          message: `Failed for /api/v2/stream/s1?st=x with ${ACCESS_TOKEN}`,
        },
      ],
    });
    render(column({ plan, secrets: [ACCESS_TOKEN, '/api/v2/stream/s1?st=x'] }));
    const shown = value(footer(), 'Notice') ?? '';
    expect(shown).toContain('[hidden]');
    expect(shown).not.toContain(ACCESS_TOKEN);
    expect(shown).not.toContain('/api/v2/stream/s1');
    expect(info().textContent).not.toContain(ACCESS_TOKEN);
  });

  it('has no footer when there is nothing to add', () => {
    render(column());
    expect(screen.queryByTestId('player-info-footer')).toBeNull();
  });

  it('writes a documented warning code in the app language, not with the server message', () => {
    const plan = playbackPlan({
      degradation_warnings: [
        { code: 'audio_track_unavailable', message: 'The selected audio track is converted.' },
      ],
    });
    render(column({ plan }));
    expect(value(within(screen.getByTestId('player-info-footer')), 'Notice')).toBe(
      'The chosen audio track is not in this file, the default plays',
    );
    expect(info()).not.toHaveTextContent('The selected audio track');
    cleanup();
    render(column({ plan, lang: 'de' }));
    expect(value(within(screen.getByTestId('player-info-footer')), 'Hinweis')).toBe(
      'Die gewählte Tonspur fehlt in dieser Datei, die Standardspur läuft',
    );
  });

  const WARNING_CODES = Object.keys(en)
    .filter((key) => key.startsWith('player.info.warn.'))
    .map((key) => key.slice('player.info.warn.'.length));

  it('knows all 14 documented warning codes', () => {
    expect(WARNING_CODES).toHaveLength(14);
    expect(Object.keys(de).filter((key) => key.startsWith('player.info.warn.'))).toHaveLength(14);
  });

  it.each(WARNING_CODES)('writes the warning %s with its own text in both languages', (code) => {
    const plan = playbackPlan({
      degradation_warnings: [{ code, message: 'SERVER TEXT' }],
    });
    const key = `player.info.warn.${code}` as keyof typeof en;
    for (const lang of ['en', 'de'] as const) {
      render(column({ plan, lang }));
      expect(value(footer(), lang === 'en' ? 'Notice' : 'Hinweis')).toBe(translate(lang, key));
      expect(info()).not.toHaveTextContent('SERVER TEXT');
      cleanup();
    }
  });

  it('hides the token and a media URL inside the message of an unknown code', () => {
    const url = `https://host.example/x?token=${ACCESS_TOKEN}`;
    const plan = playbackPlan({
      degradation_warnings: [
        { code: 'brand_new_warning', message: `Fetch ${url} failed, token ${ACCESS_TOKEN}` },
      ],
    });
    render(column({ plan, secrets: [url, ACCESS_TOKEN] }));
    const shown = value(footer(), 'Notice') ?? '';
    expect(shown).not.toContain(ACCESS_TOKEN);
    expect(shown).not.toContain('host.example');
    expect(shown).toContain('[hidden]');
  });

  it('shows the server message only for a code it does not know', () => {
    const plan = playbackPlan({
      degradation_warnings: [{ code: 'brand_new_warning', message: 'Something new happened.' }],
    });
    render(column({ plan }));
    expect(value(within(screen.getByTestId('player-info-footer')), 'Notice')).toBe(
      'Something new happened.',
    );
    cleanup();
    // A code that is a property name of every object is unknown, not a lookup.
    const odd = playbackPlan({
      degradation_warnings: [{ code: 'constructor', message: 'Odd code.' }],
    });
    render(column({ plan: odd }));
    expect(value(within(screen.getByTestId('player-info-footer')), 'Notice')).toBe('Odd code.');
  });

  it('writes the limit in German', () => {
    const plan = playbackPlan({
      bandwidth_limit: {
        kbps: 4000,
        source: 'observed_rebuffer',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
    });
    render(column({ plan, lang: 'de' }));
    expect(value(footer(), 'Begrenzung')).toBe('Auf 4 Mbit/s begrenzt (nach Rucklern)');
  });

  it('shows the media error with its code, and never a token or URL inside its message', () => {
    const error = {
      code: 3,
      message: `PIPELINE_ERROR_DECODE for /api/v2/stream/s1 (${ACCESS_TOKEN})`,
    };
    render(column({ mediaError: error, secrets: [ACCESS_TOKEN, '/api/v2/stream/s1'] }));
    const shown = value(footer(), 'Last media error') ?? '';
    expect(shown).toContain('3 · PIPELINE_ERROR_DECODE');
    expect(info().textContent).not.toContain(ACCESS_TOKEN);
    expect(info().textContent).not.toContain('/api/v2/stream/s1');
  });
});

describe('the info panel: live', () => {
  it('shows the new video element at once when the element changes, not a second later', () => {
    const { rerender } = render(column({ video: videoOfSize(1920, 1080) }));
    expect(info()).toHaveTextContent('1920×1080');
    rerender(column({ video: videoOfSize(1280, 720) }));
    expect(info()).toHaveTextContent('1280×720');
    expect(info()).not.toHaveTextContent('1920×1080');
  });

  it('refreshes once a second while it is open, and leaves no timer behind after it closes', () => {
    vi.useFakeTimers();
    const video = videoOfSize(0, 0);
    const engine = new FakeEngine();
    engine.currentTime = 10;
    engine.buffered = [{ start: 0, end: 20 }];
    const { unmount } = render(column({ video, engine }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(value(now(), 'Buffer')).toBe('10 s ahead');
    expect(value(now(), 'Picture')).toBe('–');
    // The size becomes known and more data arrives: the next second shows both.
    const state = fakeVideo(video);
    state.videoWidth = 3840;
    state.videoHeight = 2160;
    engine.buffered = [{ start: 0, end: 50 }];
    // Nothing changes between the ticks.
    act(() => void vi.advanceTimersByTime(999));
    expect(value(now(), 'Buffer')).toBe('10 s ahead');
    act(() => void vi.advanceTimersByTime(1));
    expect(info()).toHaveTextContent('3840×2160');
    expect(value(now(), 'Buffer')).toBe('40 s ahead');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is two columns, now and the source file, each with its own sections', () => {
    render(column());
    expect(screen.getByTestId('player-info-now')).toBeInTheDocument();
    expect(screen.getByTestId('player-info-source')).toBeInTheDocument();
    expect(info()).toHaveAttribute('aria-label', 'Playback info');
    expect(within(info()).queryAllByRole('button')).toHaveLength(0);
  });
});
