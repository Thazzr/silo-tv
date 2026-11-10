import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage, useT, type MessageKey } from '../../i18n';
import { languageName } from '../../i18n/languages';
import type { PlayerEngine } from '../engine/PlayerEngine';
import { redact } from '../format';
import type { MediaFacts, MediaFailure, Plan } from '../session/types';
import {
  conversions,
  dynamicRangeName,
  informativeTitle,
  reasonsOf,
  routeOf,
  selectedAudio,
  streamKind,
  subtitleChoice,
  type ReasonId,
  type Route,
  type StreamKind,
} from './info';
import {
  audioCodecName,
  channelLayout,
  formatBitrate,
  formatFileSize,
  formatFrameRate,
  formatSampleRate,
  profileName,
  videoCodecName,
} from './infoFormat';

const ROUTE_TEXT: Record<Route, MessageKey> = {
  direct: 'player.info.routeDirect',
  remux: 'player.info.routeRemux',
  transcode: 'player.info.routeTranscode',
};

const STREAM_TEXT: Record<StreamKind, MessageKey> = {
  file: 'player.info.streamFile',
  hlsTs: 'player.info.streamHlsTs',
  hlsFmp4: 'player.info.streamHlsFmp4',
  hls: 'player.info.streamHls',
};

const REASON_TEXT: Record<ReasonId, MessageKey> = {
  direct: 'player.info.reason.direct',
  quality: 'player.info.reason.quality',
  qualityAuto: 'player.info.reason.qualityAuto',
  qualityOriginal: 'player.info.reason.qualityOriginal',
  qualityDevice: 'player.info.reason.qualityDevice',
  qualityBandwidth: 'player.info.reason.qualityBandwidth',
  qualityCap: 'player.info.reason.qualityCap',
  container: 'player.info.reason.container',
  audio: 'player.info.reason.audio',
  video: 'player.info.reason.video',
  packaging: 'player.info.reason.packaging',
  burnIn: 'player.info.reason.burnIn',
  dolbyVision: 'player.info.reason.dolbyVision',
  managedRange: 'player.info.reason.managedRange',
  dolbyBase: 'player.info.reason.dolbyBase',
  noEvidence: 'player.info.reason.noEvidence',
};

/** The documented degradation warning codes (protocol v3 section 7.2) with their own texts. */
const WARNING_TEXT: Record<string, MessageKey> = {
  hdr_range_assumed_hdr10: 'player.info.warn.hdr_range_assumed_hdr10',
  dolby_vision_removed: 'player.info.warn.dolby_vision_removed',
  dolby_vision_strip_unsupported_by_source:
    'player.info.warn.dolby_vision_strip_unsupported_by_source',
  dolby_vision_enhancement_layer_discarded:
    'player.info.warn.dolby_vision_enhancement_layer_discarded',
  dolby_vision_base_layer_only: 'player.info.warn.dolby_vision_base_layer_only',
  hdr_tone_mapped: 'player.info.warn.hdr_tone_mapped',
  audio_converted: 'player.info.warn.audio_converted',
  subtitle_burn_in: 'player.info.warn.subtitle_burn_in',
  quality_reduction_unavailable: 'player.info.warn.quality_reduction_unavailable',
  quality_preference_normalized: 'player.info.warn.quality_preference_normalized',
  bandwidth_cap_applied: 'player.info.warn.bandwidth_cap_applied',
  evidence_insufficient_for_direct: 'player.info.warn.evidence_insufficient_for_direct',
  audio_track_unavailable: 'player.info.warn.audio_track_unavailable',
  subtitle_track_unavailable: 'player.info.warn.subtitle_track_unavailable',
};

/** What the engine and the element say right now; refreshed once a second while the panel is open. */
interface Reading {
  size: string | null;
  /** Seconds of data ahead of the playhead; null when nothing is buffered there. */
  ahead: number | null;
  /** hls.js's estimate in bit/s; null off hls.js or before it has one. */
  bandwidth: number | null;
  /** Null when the element cannot count them (no getVideoPlaybackQuality). */
  frames: { dropped: number; total: number } | null;
}

function read(video: HTMLVideoElement | null, engine: PlayerEngine | null): Reading {
  const quality =
    video && typeof video.getVideoPlaybackQuality === 'function'
      ? video.getVideoPlaybackQuality()
      : null;
  let ahead: number | null = null;
  if (engine) {
    const now = engine.currentTime;
    const range = engine.buffered.find((r) => now >= r.start - 0.5 && now <= r.end);
    if (range) ahead = Math.max(0, range.end - now);
  }
  return {
    size:
      video && video.videoWidth > 0 && video.videoHeight > 0
        ? `${video.videoWidth}×${video.videoHeight}`
        : null,
    ahead,
    bandwidth: engine?.decoder === 'hlsjs' ? engine.bandwidthEstimate : null,
    frames: quality
      ? { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames }
      : null,
  };
}

type Row = [label: string, value: string];
interface Section {
  title: string;
  rows: Row[];
}

const dot = (parts: (string | null | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ');

export interface InfoColumnProps {
  plan: Plan;
  media: MediaFacts;
  video: HTMLVideoElement | null;
  engine: PlayerEngine | null;
  /** The quality the viewer chose, by name, for "Quality chosen: …". */
  qualityName?: string | null;
  mediaError?: MediaFailure | null;
  /** Texts that must never reach the screen (the media URL, the token). */
  secrets?: readonly (string | undefined)[];
}

const NO_SECRETS: readonly (string | undefined)[] = [];

/**
 * Playback info, a panel on the left with two columns: what plays now and how it reaches the TV,
 * and the source file. Nothing to focus, and no path, file name, URL or token. The live readings
 * refresh once a second while it is open.
 */
export function InfoColumn({
  plan,
  media,
  video,
  engine,
  qualityName = null,
  mediaError = null,
  secrets = NO_SECRETS,
}: InfoColumnProps) {
  const t = useT();
  const lang = useLanguage();
  const decimal = lang === 'de' ? ',' : '.';
  const [reading, setReading] = useState<Reading>(() => read(video, engine));
  useEffect(() => {
    const update = () => setReading(read(video, engine));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [video, engine]);

  const dash = '–';
  const route = routeOf(plan.delivery);
  const recipe = plan.effective_recipe;
  const source = plan.source;
  const converted = conversions(plan);
  const way = (isConverted: boolean) =>
    isConverted ? t('player.info.converted') : t('player.info.direct');
  const subtitle = subtitleChoice(plan, media, lang);
  const track = selectedAudio(plan, media);

  const reasons = reasonsOf(plan).map((reason) =>
    t(REASON_TEXT[reason], { quality: qualityName ?? '' }),
  );
  const nowPlayback: Row[] = [
    [t('player.info.route'), route ? t(ROUTE_TEXT[route]) : dash],
    ...(reasons.length > 0 ? [[t('player.info.reason'), reasons.join(' · ')] as Row] : []),
    [
      t('player.info.player'),
      engine?.decoder === 'hlsjs' ? t('player.info.playerHls') : t('player.info.playerNative'),
    ],
    [t('player.info.stream'), t(STREAM_TEXT[streamKind(plan)])],
  ];

  const fps = formatFrameRate(recipe.frame_rate ?? source.frame_rate, decimal);
  const videoBitrate = formatBitrate(recipe.bitrate_kbps, decimal);
  const nowVideo: Row[] = [
    [t('player.info.picture'), dot([reading.size ?? dash, fps ? `${fps} fps` : null])],
    [
      t('player.info.codec'),
      dot([videoCodecName(recipe.video_codec ?? source.video_codec) ?? dash, way(converted.video)]),
    ],
    ...(videoBitrate ? [[t('player.info.bitrate'), videoBitrate] as Row] : []),
  ];

  const nowAudio: Row[] = [];
  if (track) {
    // The language only; the codec has its own row. A title joins when it says something more.
    const name = languageName(track.language, lang, track.title);
    const extra = informativeTitle(track.title);
    nowAudio.push([t('player.info.track'), dot([name, extra !== name ? extra : null])]);
  }
  nowAudio.push([
    t('player.info.codec'),
    dot([
      audioCodecName(recipe.audio_codec ?? source.audio_codec) ?? dash,
      channelLayout(
        recipe.audio_channels ?? source.audio_channels,
        recipe.audio_layout ?? source.audio_layout,
      ),
      way(converted.audio),
    ]),
  ]);

  const connection: Row[] = [];
  // What only shows when it applies: a full-width footer under both columns.
  const footer: Row[] = [];
  if (reading.ahead !== null) {
    connection.push([
      t('player.info.buffer'),
      t('player.info.bufferAhead', { seconds: Math.round(reading.ahead) }),
    ]);
  }
  const bandwidth = formatBitrate(
    reading.bandwidth === null ? null : reading.bandwidth / 1000,
    decimal,
  );
  if (bandwidth) connection.push([t('player.info.bandwidth'), bandwidth]);
  if (reading.frames) {
    connection.push([t('player.info.frames'), t('player.info.framesDropped', reading.frames)]);
  }
  const limit = plan.bandwidth_limit ? formatBitrate(plan.bandwidth_limit.kbps, decimal) : null;
  if (limit) footer.push([t('player.info.limit'), t('player.info.limited', { rate: limit })]);
  for (const warning of plan.degradation_warnings ?? []) {
    // A documented code has its own text; the server's message is for a code this app lacks.
    const known = Object.prototype.hasOwnProperty.call(WARNING_TEXT, warning.code)
      ? WARNING_TEXT[warning.code]
      : undefined;
    const text = known ? t(known) : redact(warning.message.trim(), secrets);
    if (text) footer.push([t('player.info.warning'), text]);
  }
  if (mediaError) {
    footer.push([
      t('player.info.mediaError'),
      redact(dot([String(mediaError.code), mediaError.message]), secrets),
    ]);
  }

  const now: Section[] = [
    { title: t('player.info.playback'), rows: nowPlayback },
    { title: t('player.info.video'), rows: nowVideo },
    { title: t('player.info.audio'), rows: nowAudio },
    {
      title: t('player.info.subtitles'),
      rows: [
        [
          t('player.info.track'),
          subtitle ? (subtitle.label ?? t('player.menu.on')) : t('player.menu.off'),
        ],
      ],
    },
    ...(connection.length > 0 ? [{ title: t('player.info.connection'), rows: connection }] : []),
  ];

  const container = (media.container ?? source.container)?.trim().toUpperCase();
  const fileRows: Row[] = [
    [t('player.info.container'), dot([container ?? dash, formatFileSize(media.fileSize, decimal)])],
  ];
  const fileBitrate = formatBitrate(media.bitrateKbps, decimal);
  if (fileBitrate) fileRows.push([t('player.info.bitrate'), fileBitrate]);
  const several = (media.versionCount ?? 0) > 1;
  const version = media.edition ?? media.resolution;
  if (several && version) fileRows.push([t('player.info.version'), version]);

  const depth = source.bit_depth ? t('player.info.bitDepth', { bits: source.bit_depth }) : null;
  const sourceFps = formatFrameRate(source.frame_rate, decimal);
  const sourceSize =
    source.width && source.height ? `${source.width}×${source.height}` : (media.resolution ?? dash);
  const sourceVideo: Row[] = [
    [
      t('player.info.codec'),
      dot([
        [
          videoCodecName(source.video_codec ?? media.videoCodec) ?? dash,
          profileName(source.video_profile),
        ]
          .filter(Boolean)
          .join(' '),
        depth,
      ]),
    ],
    [t('player.info.picture'), dot([sourceSize, sourceFps ? `${sourceFps} fps` : null])],
    [t('player.info.range'), dynamicRangeName(source, media.hdr)],
  ];

  const sourceAudio: Row[] = [];
  if (track) {
    sourceAudio.push([
      t('player.info.track'),
      dot([
        languageName(track.language, lang, track.title),
        audioCodecName(track.codec ?? source.audio_codec),
        channelLayout(track.channels, track.layout),
      ]),
    ]);
    const rates = dot([
      formatBitrate(track.bitrate, decimal),
      formatSampleRate(track.sample_rate, decimal),
    ]);
    if (rates) sourceAudio.push([t('player.info.bitrate'), rates]);
  } else {
    sourceAudio.push([
      t('player.info.track'),
      dot([
        audioCodecName(source.audio_codec) ?? dash,
        channelLayout(source.audio_channels, source.audio_layout),
      ]),
    ]);
  }

  const file: Section[] = [
    { title: t('player.info.file'), rows: fileRows },
    { title: t('player.info.video'), rows: sourceVideo },
    { title: t('player.info.audio'), rows: sourceAudio },
  ];

  const column = (id: string, heading: string, sections: Section[], extra?: ReactNode) => (
    <div className="player-info-column" data-testid={`player-info-${id}`}>
      <h2 className="player-info-title">{heading}</h2>
      {sections.map((section) => (
        <section key={section.title} className="player-info-section">
          <p className="player-menu-heading">{section.title}</p>
          <dl className="player-info-facts">
            {section.rows.map(([label, value], at) => (
              <div key={`${label}-${at}`} className="player-info-fact">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {extra}
    </div>
  );

  // Under the source-file facts: the left column is the long one and fills the panel's height.
  const footerRows =
    footer.length > 0 ? (
      <dl className="player-info-facts player-info-footer" data-testid="player-info-footer">
        {footer.map(([label, value], at) => (
          <div key={`${label}-${at}`} className="player-info-fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    ) : null;

  return (
    <aside className="player-info" aria-label={t('player.info.title')} data-testid="player-info">
      {column('now', t('player.info.now'), now)}
      {column('source', t('player.info.source'), file, footerRows)}
    </aside>
  );
}
