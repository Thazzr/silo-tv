// The device profile for Silo playback protocol v3: what this TV can do, built only from what the
// probes found. Pure; collecting the probes is in probe.ts.
import type { components } from '../api/generated/schema';
import type { HdrConfig } from '../platform/device';
import type { DisplayInfo, ProbeRow } from '../platform/mediaProbe';

type S = components['schemas'];
export type ClientCapabilities = S['ClientCodecCapabilitiesV3'];
export type PlaybackContext = S['ClientPlaybackContextV3'];
type Hdr = S['HDRCapabilitiesV3'];
type Delivery = S['DeliveryCapabilityV3'];

export interface ProfileProbe {
  media: ProbeRow[];
  display: DisplayInfo;
  hdr: HdrConfig;
  platform: 'webos' | 'browser';
  appVersion: string;
  /** webOS platform version, e.g. "24.0.0"; used for diagnostics on the server only. */
  osVersion?: string | null;
}

/** The features the client sends on start and replan. Only the base plan feature: nothing opt-in. */
export const CLIENT_FEATURES = ['playback_plan_v3'];

function row(probe: ProfileProbe, id: string): ProbeRow | undefined {
  return probe.media.find((r) => r.id === id);
}

/** A codec counts when the engine answered "probably" or MSE accepts it; "maybe" alone is a guess. */
function codecOk(probe: ProfileProbe, ...ids: string[]): boolean {
  return ids.some((id) => {
    const r = row(probe, id);
    return r !== undefined && (r.canPlayType === 'probably' || r.mse === true);
  });
}

/** A bare container type has no codec to be sure about, so "maybe" is a real answer there. */
function containerOk(probe: ProfileProbe, id: string): boolean {
  const r = row(probe, id);
  return r !== undefined && (r.canPlayType !== '' || r.mse === true);
}

function startsWith(probe: ProfileProbe, prefix: string): string[] {
  return probe.media.filter((r) => r.id.startsWith(prefix)).map((r) => r.id);
}

// H.264 level (x10) and HEVC general_level_idc of the probe rows that carry one.
const H264_LEVELS: Record<string, number> = {
  'h264-baseline-30': 30,
  'h264-main-31': 31,
  'h264-high-40': 40,
  'h264-high-51': 51,
  'h264-high-52': 52,
};
const HEVC_LEVELS: Record<string, number> = {
  'hevc-main-40': 120,
  'hevc-main-51': 153,
  'hevc-main10-51': 153,
  'hevc-main10-51-hev1': 153,
  'hevc-main10-52': 156,
  'hevc-main10-61': 183,
};

function maxLevel(probe: ProfileProbe, levels: Record<string, number>): number | undefined {
  const ok = Object.keys(levels)
    .filter((id) => codecOk(probe, id))
    .map((id) => levels[id]!);
  return ok.length > 0 ? Math.max(...ok) : undefined;
}

function videoCodecs(probe: ProfileProbe): string[] {
  const list: string[] = [];
  if (codecOk(probe, ...startsWith(probe, 'h264-'))) list.push('h264');
  if (codecOk(probe, ...startsWith(probe, 'hevc-'))) list.push('hevc');
  if (codecOk(probe, 'vp9-webm', 'vp9-mp4-p2')) list.push('vp9');
  if (codecOk(probe, ...startsWith(probe, 'av1-'))) list.push('av1');
  return list;
}

/** TrueHD is never listed, whatever a probe says: Silo converts it for this client. */
function audioCodecs(probe: ProfileProbe): string[] {
  const list: string[] = [];
  if (codecOk(probe, 'aac-lc', 'he-aac')) list.push('aac');
  if (codecOk(probe, 'mp3')) list.push('mp3');
  if (codecOk(probe, 'ac3')) list.push('ac3');
  if (codecOk(probe, 'eac3')) list.push('eac3');
  if (codecOk(probe, 'dts', 'dts-express')) list.push('dts');
  if (codecOk(probe, 'flac')) list.push('flac');
  if (codecOk(probe, 'opus-mp4', 'opus-webm')) list.push('opus');
  if (codecOk(probe, 'vorbis')) list.push('vorbis');
  return list;
}

/**
 * HDR from the TV's own flags. Dolby Vision profiles need the DV flag and the dvh1/dvhe probe
 * answer for that profile. HDR10+ is never claimed: nothing has shown the TV plays it.
 */
function hdrDetails(probe: ProfileProbe): Hdr {
  const dolbyVision: number[] = [];
  if (probe.hdr.dolbyVision) {
    if (codecOk(probe, 'dv-dvh1-05', 'dv-dvhe-05')) dolbyVision.push(5);
    if (codecOk(probe, 'dv-dvh1-08', 'dv-dvhe-08')) dolbyVision.push(8);
  }
  return {
    hdr10: probe.hdr.hdr,
    hdr10_plus: false,
    hlg: probe.hdr.hdr,
    dolby_vision_profiles: dolbyVision,
  };
}

function anyHdr(hdr: Hdr): boolean {
  return hdr.hdr10 || hdr.hlg || hdr.dolby_vision_profiles.length > 0;
}

/** The panel's resolution class: CSS pixels times the device pixel ratio. */
function maxResolution(display: DisplayInfo): string {
  const lines = Math.min(display.width, display.height) * display.devicePixelRatio;
  if (lines >= 2160) return '2160p';
  if (lines >= 1440) return '1440p';
  if (lines >= 1080) return '1080p';
  return '720p';
}

function videoDecode(probe: ProfileProbe): S['VideoDecodeCapabilityV3'][] {
  // On the declared tier these entries only narrow the flat lists, so they carry just the bounds
  // the probe measured: the highest level that answered and the bit depths.
  const hardware = probe.platform === 'webos';
  const entries: S['VideoDecodeCapabilityV3'][] = [];
  const h264 = maxLevel(probe, H264_LEVELS);
  if (h264 !== undefined) {
    entries.push({ codec: 'h264', hardware, levels: [h264], bit_depths: [8] });
  }
  const hevc = maxLevel(probe, HEVC_LEVELS);
  if (hevc !== undefined) {
    const depths: number[] = [];
    if (codecOk(probe, 'hevc-main-40', 'hevc-main-51')) depths.push(8);
    if (codecOk(probe, ...startsWith(probe, 'hevc-main10'))) depths.push(10);
    entries.push({ codec: 'hevc', hardware, levels: [hevc], bit_depths: depths });
  }
  return entries;
}

export function buildClientCapabilities(probe: ProfileProbe): ClientCapabilities {
  const codecsVideo = videoCodecs(probe);
  const hdr = hdrDetails(probe);
  const containers = originalContainers(probe);
  return {
    // The browser can only say yes or no per codec string, which is the "declared" tier. The
    // TV's decoders are hardware, but nothing here enumerates them, so no stricter tier.
    video_evidence: 'declared',
    audio_evidence: 'declared',
    codecs_video: codecsVideo,
    codecs_video_hardware: probe.platform === 'webos' ? codecsVideo : [],
    codecs_audio: audioCodecs(probe),
    containers,
    max_resolution: maxResolution(probe.display),
    hdr: anyHdr(hdr),
    hdr_details: hdr,
    video_decode: videoDecode(probe),
  };
}

/**
 * Containers the engine plays from a direct file. webOS's native pipeline plays Matroska although
 * canPlayType answers '' for it, so there it is listed without a probe answer.
 */
function originalContainers(probe: ProfileProbe): string[] {
  const list: string[] = [];
  if (containerOk(probe, 'mp4')) list.push('mp4');
  if (probe.platform === 'webos' || containerOk(probe, 'mkv')) list.push('mkv');
  if (containerOk(probe, 'webm')) list.push('webm');
  return list;
}

const SUBTITLES: Delivery['subtitles'] = {
  // The player renders no subtitles yet, so nothing is claimed. WebVTT sidecars come with the
  // subtitle work in Phase 3; then sidecar_text becomes true (still no ASS, bitmap or fonts).
  sidecar_text: false,
  embedded_text: false,
  ass_styling: false,
  embedded_bitmap: false,
  sidecar_bitmap: false,
  font_attachments: false,
};

function delivery(init: Partial<Delivery> & Pick<Delivery, 'enabled'>): Delivery {
  return {
    supported_on_device: init.enabled,
    containers: [],
    video_codecs: [],
    audio_decode_codecs: [],
    audio_passthrough_codecs: [],
    features: [],
    auth_header_refresh: false,
    validated_claims: [],
    transformations: [],
    subtitles: SUBTITLES,
    ...init,
  };
}

/** HLS is native on webOS; it counts when the engine answers for either HLS MIME type. */
function hlsSupported(probe: ProfileProbe): boolean {
  return containerOk(probe, 'hls-apple') || containerOk(probe, 'hls-x');
}

export function buildPlaybackContext(probe: ProfileProbe): PlaybackContext {
  const caps = buildClientCapabilities(probe);
  const hdr = caps.hdr_details ?? hdrDetails(probe);
  const hls = hlsSupported(probe);
  // Server-packaged HLS: only the codecs HLS carries.
  const hlsVideo = caps.codecs_video.filter((c) => c === 'h264' || c === 'hevc');
  const hlsAudio = caps.codecs_audio.filter((c) => ['aac', 'ac3', 'eac3', 'mp3'].includes(c));

  const output: S['OutputContextV3'] = { hdr_details: hdr, sink_type: 'hdmi' };
  // The flags are the TV's own answer; without them the display is "unknown" and none is sent.
  if (probe.hdr.known) output.display = { hdr_evidence: 'exact', hdr_types: hdr };

  const platformDetails: Record<string, string> = {
    // The protocol has no Atmos field at this evidence tier; kept for the server's diagnostics.
    dolby_atmos: probe.hdr.atmos ? 'true' : 'false',
    ui_resolution: `${probe.display.width}x${probe.display.height}`,
  };

  return {
    protocol_version: 3,
    form_factor: 'tv',
    app_version: probe.appVersion,
    device: {
      platform: probe.platform === 'webos' ? 'webos' : 'web',
      ...(probe.platform === 'webos' ? { manufacturer: 'LG' } : {}),
      ...(probe.osVersion ? { os_version: probe.osVersion } : {}),
      platform_details: platformDetails,
    },
    output,
    deliveries: {
      original_http: delivery({
        enabled: true,
        containers: caps.containers,
        video_codecs: caps.codecs_video,
        audio_decode_codecs: caps.codecs_audio,
      }),
      hls: hls
        ? delivery({
            enabled: true,
            containers: ['hls'],
            video_codecs: hlsVideo,
            audio_decode_codecs: hlsAudio,
          })
        : delivery({
            enabled: false,
            failure_reason: 'hls_not_supported',
          }),
      progressive: delivery({
        enabled: false,
        failure_reason: 'disabled_pending_seekable_transport',
      }),
    },
  };
}
