import { describe, expect, it } from 'vitest';
import {
  browserProbe,
  browserRows,
  hdrFlags,
  noFlags,
  tvProbe,
  tvRows,
} from '../test/profileFixtures';
import { buildClientCapabilities, buildPlaybackContext } from './deviceProfile';

describe('buildClientCapabilities, TV probe', () => {
  const caps = buildClientCapabilities(tvProbe());

  it('lists the codecs the probe confirmed, with the declared evidence tier', () => {
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
    expect(tvRows.find((r) => r.id === 'mkv')?.canPlayType).toBe('');
    expect(caps.containers).toEqual(['mp4', 'mkv', 'webm']);
    expect(caps.codecs_audio).not.toContain('truehd');
  });

  it('reports the highest probed H.264 and HEVC levels and the HEVC bit depths', () => {
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
  const context = buildPlaybackContext(tvProbe());

  it('describes the TV as a v3 client', () => {
    expect(context).toMatchObject({
      protocol_version: 3,
      form_factor: 'tv',
      app_version: '0.0.1',
      device: { platform: 'webos', manufacturer: 'LG', os_version: '24.0.0' },
    });
  });

  it('enables original_http and hls, and disables progressive', () => {
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

  it('claims WebVTT sidecar text only, nothing else for subtitles', () => {
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
  const probe = browserProbe();
  const caps = buildClientCapabilities(probe);
  const context = buildPlaybackContext(probe);

  it('omits what the browser cannot play', () => {
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
