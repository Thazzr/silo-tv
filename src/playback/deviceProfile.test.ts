import { describe, expect, it } from 'vitest';
import type { DisplayInfo, ProbeRow } from '../platform';
import {
  browserProbe,
  browserRows,
  hdrFlags,
  noFlags,
  tvProbe,
  tvRows,
} from '../test/profileFixtures';
import {
  CLIENT_FEATURES,
  HLS_VARIABLE_SUBSTITUTION,
  buildClientCapabilities,
  buildPlaybackContext,
} from './deviceProfile';

// The profile is built inside each test, not while the file is collected: Stryker's per-test coverage
// only credits code that runs inside a test, so a describe-level build would leave its mutants unkilled.
describe('buildClientCapabilities, TV probe', () => {
  const capsOf = () => buildClientCapabilities(tvProbe());

  it('lists the codecs the probe confirmed, with the declared evidence tier', () => {
    const caps = capsOf();
    expect(caps.video_evidence).toBe('declared');
    expect(caps.audio_evidence).toBe('declared');
    expect(caps.codecs_video).toEqual(['h264', 'hevc', 'vp9', 'av1']);
    expect(caps.codecs_video_hardware).toEqual(['h264', 'hevc', 'vp9', 'av1']);
    expect(caps.codecs_audio).toEqual([
      'aac',
      'mp3',
      'ac3',
      'eac3',
      'dts',
      'flac',
      'opus',
      'vorbis',
    ]);
    expect(caps.max_resolution).toBe('2160p');
  });

  it('lists mkv although the engine answers nothing for Matroska, and never TrueHD', () => {
    const caps = capsOf();
    expect(tvRows.find((r) => r.id === 'mkv')?.canPlayType).toBe('');
    expect(caps.containers).toEqual(['mp4', 'mkv', 'webm']);
    expect(caps.codecs_audio).not.toContain('truehd');
  });

  it('reports the highest probed H.264 and HEVC levels and the HEVC bit depths', () => {
    const caps = capsOf();
    expect(caps.video_decode).toEqual([
      { codec: 'h264', hardware: true, levels: [52], bit_depths: [8] },
      { codec: 'hevc', hardware: true, levels: [183], bit_depths: [8, 10] },
    ]);
  });

  it('never lists TrueHD, even when the probe says it plays', () => {
    const media = tvRows.map((r) =>
      r.id === 'truehd' ? { ...r, canPlayType: 'probably' as const, mse: true } : r,
    );
    expect(buildClientCapabilities(tvProbe({ media })).codecs_audio).not.toContain('truehd');
  });
});

describe('HDR, Dolby Vision and Atmos follow the TV flags', () => {
  it('reports HDR10, HLG and Dolby Vision 5 and 8 with all flags and probe answers', () => {
    const caps = buildClientCapabilities(tvProbe({ hdr: hdrFlags }));
    expect(caps.hdr).toBe(true);
    expect(caps.hdr_details).toEqual({
      hdr10: true,
      hdr10_plus: false,
      hlg: true,
      dolby_vision_profiles: [5, 8],
    });
  });

  it('reports no HDR at all without the flags, whatever the probe answers', () => {
    const caps = buildClientCapabilities(tvProbe({ hdr: noFlags }));
    expect(caps.hdr).toBe(false);
    expect(caps.hdr_details).toEqual({
      hdr10: false,
      hdr10_plus: false,
      hlg: false,
      dolby_vision_profiles: [],
    });
  });

  it('needs the HDR flag for HDR10 and HLG, and its own flag for Dolby Vision', () => {
    const hdrOnly = buildClientCapabilities(tvProbe({ hdr: { ...noFlags, hdr: true } }));
    expect(hdrOnly.hdr_details).toMatchObject({
      hdr10: true,
      hlg: true,
      dolby_vision_profiles: [],
    });
    const dvOnly = buildClientCapabilities(tvProbe({ hdr: { ...noFlags, dolbyVision: true } }));
    expect(dvOnly.hdr_details).toMatchObject({
      hdr10: false,
      hlg: false,
      dolby_vision_profiles: [5, 8],
    });
    expect(dvOnly.hdr).toBe(true);
  });

  it('lists a Dolby Vision profile only when its dvh1/dvhe probe answered', () => {
    const media = tvRows.map((r) =>
      r.id === 'dv-dvh1-08' || r.id === 'dv-dvhe-08'
        ? { ...r, canPlayType: '' as const, mse: false }
        : r,
    );
    expect(buildClientCapabilities(tvProbe({ media })).hdr_details?.dolby_vision_profiles).toEqual([
      5,
    ]);
  });

  it('carries Atmos only when the TV flag is set, as a diagnostic detail', () => {
    const on = buildPlaybackContext(tvProbe({ hdr: hdrFlags }));
    const off = buildPlaybackContext(tvProbe({ hdr: { ...hdrFlags, atmos: false } }));
    expect(on.device.platform_details?.dolby_atmos).toBe('true');
    expect(off.device.platform_details?.dolby_atmos).toBe('false');
  });
});

describe('buildPlaybackContext', () => {
  const contextOf = () => buildPlaybackContext(tvProbe());

  it('describes the TV as a v3 client', () => {
    const context = contextOf();
    expect(context).toMatchObject({
      protocol_version: 3,
      form_factor: 'tv',
      app_version: '0.0.1',
      device: { platform: 'webos', manufacturer: 'LG', os_version: '24.0.0' },
    });
  });

  it('enables original_http and hls, and disables progressive', () => {
    const context = contextOf();
    const { original_http, hls, progressive } = context.deliveries;
    expect(original_http).toMatchObject({
      enabled: true,
      supported_on_device: true,
      containers: ['mp4', 'mkv', 'webm'],
      video_codecs: ['h264', 'hevc', 'vp9', 'av1'],
    });
    expect(hls).toMatchObject({
      enabled: true,
      supported_on_device: true,
      containers: ['hls'],
      video_codecs: ['h264', 'hevc'],
      audio_decode_codecs: ['aac', 'mp3', 'ac3', 'eac3'],
    });
    expect(progressive).toMatchObject({ enabled: false, supported_on_device: false });
    expect(progressive?.failure_reason).toBeTruthy();
  });

  it('lists hls_variable_substitution_v1 only when hls.js plays the HLS', () => {
    const context = contextOf();
    expect(context.deliveries.hls?.features).toEqual([]);
    const viaHlsJs = buildPlaybackContext(tvProbe({ hlsJs: true }));
    expect(viaHlsJs.deliveries.hls).toMatchObject({
      enabled: true,
      features: ['hls_variable_substitution_v1'],
    });
    expect(viaHlsJs.deliveries.original_http?.features).toEqual([]);
  });

  it('claims HLS codecs through hls.js only when MSE accepts them', () => {
    const media = tvRows.map((r) => (r.id === 'ac3' ? { ...r, mse: false } : r));
    const hls = buildPlaybackContext(tvProbe({ media, hlsJs: true })).deliveries.hls;
    expect(hls?.audio_decode_codecs).not.toContain('ac3');
    expect(hls?.audio_decode_codecs).toContain('aac');
    // The native player's own answer still counts without hls.js.
    expect(buildPlaybackContext(tvProbe({ media })).deliveries.hls?.audio_decode_codecs).toContain(
      'ac3',
    );
  });

  describe('the MSE narrowing of the HLS claim through hls.js', () => {
    type Mutate = (r: (typeof tvRows)[number]) => (typeof tvRows)[number];
    const claim = (change: Mutate, hlsJs: boolean) =>
      buildPlaybackContext(tvProbe({ media: tvRows.map(change), hlsJs })).deliveries.hls!;
    const only =
      (ids: string[], patch: Partial<(typeof tvRows)[number]>): Mutate =>
      (r) =>
        ids.includes(r.id) ? { ...r, ...patch } : r;
    const h264Ids = tvRows.filter((r) => r.id.startsWith('h264-')).map((r) => r.id);
    const hevcIds = tvRows.filter((r) => r.id.startsWith('hevc-')).map((r) => r.id);

    it('drops h264 when no h264 row passes MSE, and keeps it natively', () => {
      const change = only(h264Ids, { mse: false });
      expect(claim(change, true).video_codecs).toEqual(['hevc']);
      expect(claim(change, false).video_codecs).toEqual(['h264', 'hevc']);
    });

    it('drops hevc when no hevc row passes MSE, and keeps it natively', () => {
      const change = only(hevcIds, { mse: false });
      expect(claim(change, true).video_codecs).toEqual(['h264']);
      expect(claim(change, false).video_codecs).toEqual(['h264', 'hevc']);
    });

    it('keeps h264 while a single h264 row passes MSE', () => {
      const keep = h264Ids[0]!;
      const change: Mutate = (r) => (h264Ids.includes(r.id) ? { ...r, mse: r.id === keep } : r);
      expect(claim(change, true).video_codecs).toContain('h264');
    });

    it('drops eac3 and mp3 on their own rows only', () => {
      expect(claim(only(['eac3'], { mse: false }), true).audio_decode_codecs).toEqual([
        'aac',
        'mp3',
        'ac3',
      ]);
      expect(claim(only(['mp3'], { mse: false }), true).audio_decode_codecs).toEqual([
        'aac',
        'ac3',
        'eac3',
      ]);
    });

    it('claims aac when only HE-AAC passes MSE, and not when neither does', () => {
      expect(claim(only(['aac-lc'], { mse: false }), true).audio_decode_codecs).toContain('aac');
      expect(claim(only(['he-aac'], { mse: false }), true).audio_decode_codecs).toContain('aac');
      expect(
        claim(only(['aac-lc', 'he-aac'], { mse: false }), true).audio_decode_codecs,
      ).not.toContain('aac');
    });

    it('does not claim a codec whose mse answer is missing', () => {
      const missing: Mutate = (r) => {
        if (!['ac3', 'mp3', 'eac3', ...h264Ids].includes(r.id)) return r;
        const copy = { ...r } as Partial<typeof r>;
        delete copy.mse;
        return copy as typeof r;
      };
      const hls = claim(missing, true);
      expect(hls.audio_decode_codecs).toEqual(['aac']);
      expect(hls.video_codecs).toEqual(['hevc']);
    });
  });

  it('enables hls on a browser without native HLS when hls.js works', () => {
    const hls = buildPlaybackContext(browserProbe({ hlsJs: true })).deliveries.hls;
    expect(hls).toMatchObject({ enabled: true, features: ['hls_variable_substitution_v1'] });
  });

  it('claims WebVTT sidecar text only, nothing else for subtitles', () => {
    const context = contextOf();
    for (const name of ['original_http', 'hls'] as const) {
      expect(context.deliveries[name]?.subtitles).toEqual({
        sidecar_text: true,
        embedded_text: false,
        ass_styling: false,
        embedded_bitmap: false,
        sidecar_bitmap: false,
        font_attachments: false,
      });
    }
  });

  it('sends the display evidence only when the TV answered its HDR flags', () => {
    const context = contextOf();
    expect(context.output.display).toEqual({
      hdr_evidence: 'exact',
      hdr_types: context.output.hdr_details,
    });
    const unknown = buildPlaybackContext(tvProbe({ hdr: { ...noFlags, known: false } }));
    expect(unknown.output.display).toBeUndefined();
    expect(unknown.output.hdr_details?.hdr10).toBe(false);
  });
});

describe('browser probe without HEVC, Dolby Vision, HLS and Matroska', () => {
  const probe = () => browserProbe();

  it('omits what the browser cannot play', () => {
    const caps = buildClientCapabilities(probe());
    expect(browserRows.find((r) => r.id === 'hevc-main-40')?.canPlayType).toBe('');
    expect(caps.codecs_video).toEqual(['h264', 'vp9', 'av1']);
    expect(caps.codecs_video).not.toContain('hevc');
    expect(caps.video_decode?.map((d) => d.codec)).toEqual(['h264']);
    expect(caps.video_decode?.[0]?.levels).toEqual([40]);
    expect(caps.containers).toEqual(['mp4', 'webm']);
    expect(caps.hdr_details?.dolby_vision_profiles).toEqual([]);
    expect(caps.codecs_video_hardware).toEqual([]);
    expect(caps.max_resolution).toBe('1080p');
  });

  it('disables hls without an HLS answer, and progressive stays disabled', () => {
    const context = buildPlaybackContext(probe());
    expect(context.deliveries.hls).toMatchObject({ enabled: false, supported_on_device: false });
    expect(context.deliveries.progressive).toMatchObject({ enabled: false });
    expect(context.device.platform).toBe('web');
    expect(context.device).not.toHaveProperty('manufacturer');
  });

  it('counts a codec on MSE alone, and never on a bare "maybe"', () => {
    const media = browserRows.map((r) =>
      r.id === 'hevc-main-40'
        ? { ...r, canPlayType: '' as const, mse: true }
        : r.id === 'hevc-main-51'
          ? { ...r, canPlayType: 'maybe' as const, mse: false }
          : r,
    );
    expect(buildClientCapabilities(browserProbe({ media })).codecs_video).toContain('hevc');
    const onlyMaybe = media.map((r) => (r.id === 'hevc-main-40' ? { ...r, mse: false } : r));
    expect(buildClientCapabilities(browserProbe({ media: onlyMaybe })).codecs_video).not.toContain(
      'hevc',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Exact, row-by-row pinning of the profile. Each probe below holds only the rows a test names, so
// every codec row, container and boundary is checked on its own.

type Answer = ProbeRow['canPlayType'];

function mk(id: string, canPlayType: Answer = 'probably', mse: boolean | null = true): ProbeRow {
  return { id, label: id, mime: id, canPlayType, mse };
}

/** A non-TV probe with only these rows: the TV-only rules (mkv, hardware) stay out of the way. */
const webCaps = (...rows: ProbeRow[]) => buildClientCapabilities(browserProbe({ media: rows }));
const tvCaps = (...rows: ProbeRow[]) => buildClientCapabilities(tvProbe({ media: rows }));

describe('codec rows, one probe row at a time', () => {
  it('lists nothing for a probe without rows', () => {
    const caps = webCaps();
    expect(caps.codecs_video).toEqual([]);
    expect(caps.codecs_audio).toEqual([]);
    expect(caps.containers).toEqual([]);
    expect(caps.video_decode).toEqual([]);
  });

  it.each([
    ['aac-lc', 'aac'],
    ['he-aac', 'aac'],
    ['mp3', 'mp3'],
    ['ac3', 'ac3'],
    ['eac3', 'eac3'],
    ['dts', 'dts'],
    ['dts-express', 'dts'],
    ['flac', 'flac'],
    ['opus-mp4', 'opus'],
    ['opus-webm', 'opus'],
    ['vorbis', 'vorbis'],
  ])('audio row %s alone yields exactly [%s]', (id, codec) => {
    expect(webCaps(mk(id)).codecs_audio).toEqual([codec]);
    expect(webCaps(mk(id)).codecs_video).toEqual([]);
  });

  it('keeps the audio order aac, mp3, ac3, eac3, dts, flac, opus, vorbis', () => {
    const ids = ['vorbis', 'opus-webm', 'flac', 'dts', 'eac3', 'ac3', 'mp3', 'aac-lc'];
    expect(webCaps(...ids.map((id) => mk(id))).codecs_audio).toEqual([
      'aac',
      'mp3',
      'ac3',
      'eac3',
      'dts',
      'flac',
      'opus',
      'vorbis',
    ]);
  });

  it('lists an audio codec once when both of its rows answer', () => {
    expect(webCaps(mk('aac-lc'), mk('he-aac')).codecs_audio).toEqual(['aac']);
    expect(webCaps(mk('opus-mp4'), mk('opus-webm')).codecs_audio).toEqual(['opus']);
    expect(webCaps(mk('dts'), mk('dts-express')).codecs_audio).toEqual(['dts']);
  });

  it.each([
    ['h264-baseline-30', 'h264'],
    ['h264-main-31', 'h264'],
    ['h264-high-40', 'h264'],
    ['h264-high-51', 'h264'],
    ['h264-high-52', 'h264'],
    ['hevc-main-40', 'hevc'],
    ['hevc-main-51', 'hevc'],
    ['hevc-main10-51', 'hevc'],
    ['hevc-main10-51-hev1', 'hevc'],
    ['hevc-main10-52', 'hevc'],
    ['hevc-main10-61', 'hevc'],
    ['vp9-webm', 'vp9'],
    ['vp9-mp4-p2', 'vp9'],
    ['av1-main-08', 'av1'],
    ['av1-main-10-51', 'av1'],
    ['av1-main-10-60', 'av1'],
  ])('video row %s alone yields exactly [%s]', (id, codec) => {
    expect(webCaps(mk(id)).codecs_video).toEqual([codec]);
    expect(webCaps(mk(id)).codecs_audio).toEqual([]);
  });

  it('lists no video codec for rows that are not codec rows', () => {
    const rows = ['dv-dvh1-05', 'dv-dav1-10', 'truehd', 'mp4', 'mkv', 'webm', 'hls-x'].map((id) =>
      mk(id),
    );
    expect(webCaps(...rows).codecs_video).toEqual([]);
  });

  it('keeps the video order h264, hevc, vp9, av1', () => {
    const ids = ['av1-main-08', 'vp9-webm', 'hevc-main-40', 'h264-high-40'];
    expect(webCaps(...ids.map((id) => mk(id))).codecs_video).toEqual([
      'h264',
      'hevc',
      'vp9',
      'av1',
    ]);
  });

  it('never lists TrueHD', () => {
    expect(webCaps(mk('truehd')).codecs_audio).toEqual([]);
  });

  it('mirrors the video list into the hardware list on a TV, and leaves it empty elsewhere', () => {
    expect(tvCaps(mk('h264-high-40'), mk('vp9-webm')).codecs_video_hardware).toEqual([
      'h264',
      'vp9',
    ]);
    expect(webCaps(mk('h264-high-40'), mk('vp9-webm')).codecs_video_hardware).toEqual([]);
    expect(tvCaps().codecs_video_hardware).toEqual([]);
  });
});

describe('what counts as an answer', () => {
  // [canPlayType, mse, counts as a codec, counts as a container]
  const answers: [Answer, boolean | null, boolean, boolean][] = [
    ['probably', true, true, true],
    ['probably', false, true, true],
    ['probably', null, true, true],
    ['maybe', true, true, true],
    ['maybe', false, false, true],
    ['maybe', null, false, true],
    ['', true, true, true],
    ['', false, false, false],
    ['', null, false, false],
  ];

  it.each(answers)('codec row canPlayType %j / mse %j counts: %j', (canPlayType, mse, codec) => {
    expect(webCaps(mk('aac-lc', canPlayType, mse)).codecs_audio).toEqual(codec ? ['aac'] : []);
    expect(webCaps(mk('h264-high-40', canPlayType, mse)).codecs_video).toEqual(
      codec ? ['h264'] : [],
    );
  });

  it.each(answers)(
    'container row canPlayType %j / mse %j counts: %j / %j',
    (canPlayType, mse, _codec, container) => {
      expect(webCaps(mk('mp4', canPlayType, mse)).containers).toEqual(container ? ['mp4'] : []);
      expect(webCaps(mk('webm', canPlayType, mse)).containers).toEqual(container ? ['webm'] : []);
      expect(webCaps(mk('mkv', canPlayType, mse)).containers).toEqual(container ? ['mkv'] : []);
    },
  );

  it('lists a container only for its own row', () => {
    expect(webCaps(mk('mp4')).containers).toEqual(['mp4']);
    expect(webCaps(mk('webm')).containers).toEqual(['webm']);
    expect(webCaps(mk('mp3')).containers).toEqual([]);
  });
});

describe('containers', () => {
  it('lists mkv on a TV with no Matroska row at all, and with a blank answer', () => {
    expect(tvCaps().containers).toEqual(['mkv']);
    expect(tvCaps(mk('mkv', '', false)).containers).toEqual(['mkv']);
  });

  it('lists mkv off a TV only on an answer, and keeps the order mp4, mkv, webm', () => {
    expect(webCaps(mk('mkv', '', false)).containers).toEqual([]);
    expect(webCaps(mk('webm', 'maybe'), mk('mkv', 'maybe'), mk('mp4', 'maybe')).containers).toEqual(
      ['mp4', 'mkv', 'webm'],
    );
  });

  it('adds mp4 and webm on a TV only on their own answers', () => {
    expect(tvCaps(mk('mp4', 'maybe')).containers).toEqual(['mp4', 'mkv']);
    expect(tvCaps(mk('webm', 'maybe')).containers).toEqual(['mkv', 'webm']);
  });
});

describe('video_decode bounds', () => {
  const h264Levels: [string, number][] = [
    ['h264-baseline-30', 30],
    ['h264-main-31', 31],
    ['h264-high-40', 40],
    ['h264-high-51', 51],
    ['h264-high-52', 52],
  ];
  const hevcRows: [string, number, number[]][] = [
    ['hevc-main-40', 120, [8]],
    ['hevc-main-51', 153, [8]],
    ['hevc-main10-51', 153, [10]],
    ['hevc-main10-51-hev1', 153, [10]],
    ['hevc-main10-52', 156, [10]],
    ['hevc-main10-61', 183, [10]],
  ];

  it.each(h264Levels)('h264 row %s alone gives level %i, 8 bit, hardware on a TV', (id, level) => {
    expect(tvCaps(mk(id)).video_decode).toEqual([
      { codec: 'h264', hardware: true, levels: [level], bit_depths: [8] },
    ]);
    expect(webCaps(mk(id)).video_decode).toEqual([
      { codec: 'h264', hardware: false, levels: [level], bit_depths: [8] },
    ]);
  });

  it('takes the highest answered h264 level, not the lowest, whatever the row order', () => {
    const rows = [mk('h264-high-52'), mk('h264-baseline-30'), mk('h264-high-40')];
    expect(webCaps(...rows).video_decode?.[0]?.levels).toEqual([52]);
    expect(webCaps(...[...rows].reverse()).video_decode?.[0]?.levels).toEqual([52]);
  });

  it('ignores a higher h264 level that did not answer', () => {
    const rows = [mk('h264-high-40'), mk('h264-high-52', 'maybe', false)];
    expect(webCaps(...rows).video_decode).toEqual([
      { codec: 'h264', hardware: false, levels: [40], bit_depths: [8] },
    ]);
  });

  it.each(hevcRows)('hevc row %s alone gives level %i and bit depths %j', (id, level, depths) => {
    expect(tvCaps(mk(id)).video_decode).toEqual([
      { codec: 'hevc', hardware: true, levels: [level], bit_depths: depths },
    ]);
    expect(webCaps(mk(id)).video_decode).toEqual([
      { codec: 'hevc', hardware: false, levels: [level], bit_depths: depths },
    ]);
  });

  it('takes the highest answered hevc level and lists 8 then 10 bit', () => {
    const rows = [mk('hevc-main10-61'), mk('hevc-main-40'), mk('hevc-main10-52')];
    expect(webCaps(...rows).video_decode).toEqual([
      { codec: 'hevc', hardware: false, levels: [183], bit_depths: [8, 10] },
    ]);
    expect(webCaps(mk('hevc-main-51'), mk('hevc-main10-51')).video_decode?.[0]?.levels).toEqual([
      153,
    ]);
    expect(webCaps(mk('hevc-main-40'), mk('hevc-main10-52')).video_decode?.[0]?.levels).toEqual([
      156,
    ]);
  });

  it('lists h264 before hevc and nothing for codecs without levels', () => {
    const rows = [mk('hevc-main-51'), mk('h264-main-31'), mk('vp9-webm'), mk('av1-main-08')];
    expect(webCaps(...rows).video_decode).toEqual([
      { codec: 'h264', hardware: false, levels: [31], bit_depths: [8] },
      { codec: 'hevc', hardware: false, levels: [153], bit_depths: [8] },
    ]);
    expect(webCaps(mk('vp9-webm'), mk('av1-main-08')).video_decode).toEqual([]);
  });
});

describe('max_resolution', () => {
  const display = (width: number, height: number, devicePixelRatio: number): DisplayInfo => ({
    ...tvProbe().display,
    width,
    height,
    devicePixelRatio,
  });
  const resolution = (d: DisplayInfo) =>
    buildClientCapabilities(tvProbe({ display: d })).max_resolution;

  it.each([
    [1920, 1080, 2, '2160p'],
    [3840, 2160, 1, '2160p'],
    [3840, 2159, 1, '1440p'],
    [2560, 1440, 1, '1440p'],
    [2560, 1439, 1, '1080p'],
    [1920, 1080, 1, '1080p'],
    [1920, 1079, 1, '720p'],
    [1280, 720, 1, '720p'],
    [1280, 720, 1.5, '1080p'],
    [1280, 720, 3, '2160p'],
    [1280, 720, 2, '1440p'],
  ])('%ix%i at ratio %f is %s', (w, h, dpr, expected) => {
    expect(resolution(display(w, h, dpr))).toBe(expected);
  });

  it('uses the shorter side, so a rotated or very wide panel is not overrated', () => {
    expect(resolution(display(3840, 1080, 1))).toBe('1080p');
    expect(resolution(display(1080, 3840, 1))).toBe('1080p');
    expect(resolution(display(1080, 1920, 1))).toBe('1080p');
  });
});

describe('HDR flags', () => {
  const hdrOf = (hdr: typeof noFlags, media?: ProbeRow[]) =>
    buildClientCapabilities(tvProbe({ hdr, ...(media ? { media } : {}) }));

  it('sets hdr when HDR10/HLG alone is on, and when only Dolby Vision is on', () => {
    expect(hdrOf({ ...noFlags, hdr: true }).hdr).toBe(true);
    expect(hdrOf({ ...noFlags, dolbyVision: true }).hdr).toBe(true);
    expect(hdrOf(noFlags).hdr).toBe(false);
  });

  it('keeps hdr false with the DV flag but no answering DV probe row', () => {
    const caps = hdrOf({ ...noFlags, dolbyVision: true }, [mk('h264-high-40')]);
    expect(caps.hdr).toBe(false);
    expect(caps.hdr_details?.dolby_vision_profiles).toEqual([]);
  });

  it.each([
    ['dv-dvh1-05', [5]],
    ['dv-dvhe-05', [5]],
    ['dv-dvh1-08', [8]],
    ['dv-dvhe-08', [8]],
    ['dv-dav1-10', []],
  ])('DV row %s alone gives profiles %j and needs the DV flag', (id, profiles) => {
    const on = hdrOf({ ...noFlags, dolbyVision: true }, [mk(id)]);
    expect(on.hdr_details?.dolby_vision_profiles).toEqual(profiles);
    expect(on.hdr).toBe(profiles.length > 0);
    expect(hdrOf(noFlags, [mk(id)]).hdr_details?.dolby_vision_profiles).toEqual([]);
  });

  it('never claims HDR10+', () => {
    expect(hdrOf(hdrFlags).hdr_details?.hdr10_plus).toBe(false);
  });
});

describe('the playback context, exact', () => {
  const SUBTITLES = {
    sidecar_text: true,
    embedded_text: false,
    ass_styling: false,
    embedded_bitmap: false,
    sidecar_bitmap: false,
    font_attachments: false,
  };
  const DEFAULTS = {
    containers: [],
    video_codecs: [],
    audio_decode_codecs: [],
    audio_passthrough_codecs: [],
    features: [],
    auth_header_refresh: false,
    validated_claims: [],
    transformations: [],
    subtitles: SUBTITLES,
  };
  const ALL_HDR = { hdr10: true, hdr10_plus: false, hlg: true, dolby_vision_profiles: [5, 8] };

  it('exports the base client feature and the hls.js feature id', () => {
    expect(CLIENT_FEATURES).toEqual(['playback_plan_v3']);
    expect(HLS_VARIABLE_SUBSTITUTION).toBe('hls_variable_substitution_v1');
  });

  it('builds the full TV context with every default of a delivery', () => {
    expect(buildPlaybackContext(tvProbe())).toEqual({
      protocol_version: 3,
      form_factor: 'tv',
      app_version: '0.0.1',
      device: {
        platform: 'webos',
        manufacturer: 'LG',
        os_version: '24.0.0',
        platform_details: { dolby_atmos: 'true', ui_resolution: '1920x1080' },
      },
      output: {
        hdr_details: ALL_HDR,
        sink_type: 'hdmi',
        display: { hdr_evidence: 'exact', hdr_types: ALL_HDR },
      },
      deliveries: {
        original_http: {
          ...DEFAULTS,
          enabled: true,
          supported_on_device: true,
          containers: ['mp4', 'mkv', 'webm'],
          video_codecs: ['h264', 'hevc', 'vp9', 'av1'],
          audio_decode_codecs: ['aac', 'mp3', 'ac3', 'eac3', 'dts', 'flac', 'opus', 'vorbis'],
        },
        hls: {
          ...DEFAULTS,
          enabled: true,
          supported_on_device: true,
          containers: ['hls'],
          video_codecs: ['h264', 'hevc'],
          audio_decode_codecs: ['aac', 'mp3', 'ac3', 'eac3'],
        },
        progressive: {
          ...DEFAULTS,
          enabled: false,
          supported_on_device: false,
          failure_reason: 'disabled_pending_seekable_transport',
        },
      },
    });
  });

  it('builds the disabled hls delivery with its failure reason when nothing answers for HLS', () => {
    expect(buildPlaybackContext(browserProbe()).deliveries.hls).toEqual({
      ...DEFAULTS,
      enabled: false,
      supported_on_device: false,
      failure_reason: 'hls_not_supported',
    });
  });

  it('enables hls on either HLS MIME type, and counts a bare "maybe" or MSE for it', () => {
    const enabled = (...rows: ProbeRow[]) =>
      buildPlaybackContext(browserProbe({ media: rows })).deliveries.hls?.enabled;
    expect(enabled(mk('hls-apple', 'maybe', false))).toBe(true);
    expect(enabled(mk('hls-x', 'maybe', false))).toBe(true);
    expect(enabled(mk('hls-apple', '', true))).toBe(true);
    expect(enabled(mk('hls-x', '', false), mk('hls-apple', 'probably', false))).toBe(true);
    expect(enabled(mk('hls-apple', '', false), mk('hls-x', '', false))).toBe(false);
    expect(enabled(mk('hls-apple', '', null))).toBe(false);
    expect(enabled()).toBe(false);
  });

  it('enables hls through hls.js without any HLS answer, and only then', () => {
    const rows = [mk('h264-high-40'), mk('aac-lc')];
    const via = buildPlaybackContext(browserProbe({ media: rows, hlsJs: true })).deliveries.hls;
    expect(via).toEqual({
      ...DEFAULTS,
      enabled: true,
      supported_on_device: true,
      containers: ['hls'],
      video_codecs: ['h264'],
      audio_decode_codecs: ['aac'],
      features: ['hls_variable_substitution_v1'],
    });
    for (const hlsJs of [false, undefined]) {
      const off = buildPlaybackContext(browserProbe({ media: rows, hlsJs })).deliveries.hls;
      expect(off).toMatchObject({ enabled: false, supported_on_device: false });
    }
  });

  it('claims for hls only the codecs HLS carries, natively and through hls.js', () => {
    for (const hlsJs of [false, true]) {
      const hls = buildPlaybackContext(tvProbe({ hlsJs })).deliveries.hls;
      expect(hls?.video_codecs).toEqual(['h264', 'hevc']);
      expect(hls?.audio_decode_codecs).toEqual(['aac', 'mp3', 'ac3', 'eac3']);
    }
  });

  it('keeps native-only rows (no MSE) out of the hls.js claim but in the native one', () => {
    const rows = [
      mk('h264-high-40', 'probably', false),
      mk('hevc-main-40', 'probably', null),
      mk('aac-lc', 'probably', false),
      mk('eac3', 'probably', null),
      mk('hls-apple', 'maybe', false),
    ];
    const hlsOf = (hlsJs: boolean) =>
      buildPlaybackContext(tvProbe({ media: rows, hlsJs })).deliveries.hls;
    expect(hlsOf(true)).toMatchObject({ video_codecs: [], audio_decode_codecs: [] });
    expect(hlsOf(false)).toMatchObject({
      video_codecs: ['h264', 'hevc'],
      audio_decode_codecs: ['aac', 'eac3'],
    });
  });

  it('gives original_http the full lists and no features, even through hls.js', () => {
    const http = buildPlaybackContext(tvProbe({ hlsJs: true })).deliveries.original_http;
    expect(http?.features).toEqual([]);
    expect(http?.audio_decode_codecs).toEqual([
      'aac',
      'mp3',
      'ac3',
      'eac3',
      'dts',
      'flac',
      'opus',
      'vorbis',
    ]);
  });

  it('lists the browser containers on original_http', () => {
    const http = buildPlaybackContext(browserProbe()).deliveries.original_http;
    expect(http).toMatchObject({ enabled: true, supported_on_device: true });
    expect(http?.containers).toEqual(['mp4', 'webm']);
  });

  it('sends the display evidence and the exact hdr details only for known flags', () => {
    const known = buildPlaybackContext(tvProbe({ hdr: { ...noFlags, hdr: true } })).output;
    const details = { hdr10: true, hdr10_plus: false, hlg: true, dolby_vision_profiles: [] };
    expect(known).toEqual({
      hdr_details: details,
      sink_type: 'hdmi',
      display: { hdr_evidence: 'exact', hdr_types: details },
    });
    const unknown = buildPlaybackContext(tvProbe({ hdr: { ...noFlags, known: false } })).output;
    expect(unknown).toEqual({
      hdr_details: { hdr10: false, hdr10_plus: false, hlg: false, dolby_vision_profiles: [] },
      sink_type: 'hdmi',
    });
  });

  it('writes the UI resolution as width x height and atmos as a string', () => {
    const display = { ...tvProbe().display, width: 1280, height: 720 };
    const details = buildPlaybackContext(tvProbe({ display, hdr: { ...hdrFlags, atmos: false } }))
      .device.platform_details;
    expect(details).toEqual({ dolby_atmos: 'false', ui_resolution: '1280x720' });
  });

  it.each([
    ['both present', 'LG', '24.0.0', { manufacturer: 'LG', os_version: '24.0.0' }],
    ['manufacturer null', null, '24.0.0', { os_version: '24.0.0' }],
    ['manufacturer empty', '', '24.0.0', { os_version: '24.0.0' }],
    ['os version null', 'LG', null, { manufacturer: 'LG' }],
    ['os version empty', 'LG', '', { manufacturer: 'LG' }],
    ['os version missing', 'LG', undefined, { manufacturer: 'LG' }],
    ['neither', null, undefined, {}],
  ])('device identity with %s', (_name, manufacturer, osVersion, extra) => {
    const probe = tvProbe({ manufacturer, osVersion });
    if (osVersion === undefined) delete probe.osVersion;
    expect(buildPlaybackContext(probe).device).toEqual({
      platform: 'webos',
      ...extra,
      platform_details: { dolby_atmos: 'true', ui_resolution: '1920x1080' },
    });
  });
});
