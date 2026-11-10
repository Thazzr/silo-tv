import { useEffect, useState } from 'react';
import { useT, type MessageKey } from '../../i18n';
import type { MediaFacts, Plan } from '../usePlaybackSession';
import {
  audioText,
  routeOf,
  sourceFacts,
  streamType,
  subtitleText,
  videoCodecText,
  type Route,
} from './info';

const ROUTE_TEXT: Record<Route, MessageKey> = {
  direct: 'player.info.routeDirect',
  remux: 'player.info.routeRemux',
  transcode: 'player.info.routeTranscode',
};

interface Reading {
  size: string | null;
  /** Null when the engine cannot count them (no getVideoPlaybackQuality). */
  dropped: number | null;
}

function read(video: HTMLVideoElement | null): Reading {
  if (!video) return { size: null, dropped: null };
  const quality =
    typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
  return {
    size:
      video.videoWidth > 0 && video.videoHeight > 0
        ? `${video.videoWidth}×${video.videoHeight}`
        : null,
    dropped: quality ? quality.droppedVideoFrames : null,
  };
}

/**
 * Playback info, the column on the left: what plays and how it reaches the TV, in label: value
 * rows. Nothing to focus, and no path, URL or token. The video's own readings refresh once a
 * second while it is open.
 */
export function InfoColumn({
  plan,
  media,
  video,
}: {
  plan: Plan;
  media: MediaFacts;
  video: HTMLVideoElement | null;
}) {
  const t = useT();
  const [reading, setReading] = useState<Reading>(() => read(video));
  useEffect(() => {
    const update = () => setReading(read(video));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [video]);

  const route = routeOf(plan.delivery);
  const source = sourceFacts(plan, media);
  const subtitle = subtitleText(plan, media);
  const dash = '–';

  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: t('player.info.playback'),
      rows: [
        [t('player.info.route'), route ? t(ROUTE_TEXT[route]) : plan.delivery],
        [
          t('player.info.streamType'),
          streamType(route) === 'progressive' ? t('player.info.progressive') : t('player.info.hls'),
        ],
      ],
    },
    {
      title: t('player.info.video'),
      rows: [
        [t('player.info.resolution'), reading.size ?? dash],
        ...(reading.dropped !== null
          ? [[t('player.info.dropped'), String(reading.dropped)] as [string, string]]
          : []),
      ],
    },
    {
      title: t('player.info.stream'),
      rows: [
        [t('player.info.videoCodec'), videoCodecText(plan, media) ?? dash],
        [t('player.info.audio'), audioText(plan, media) ?? dash],
        [
          t('player.info.subtitles'),
          subtitle ? (subtitle.label ?? t('player.menu.on')) : t('player.menu.off'),
        ],
      ],
    },
    {
      title: t('player.info.source'),
      rows: [
        ...(source.container
          ? [[t('player.info.container'), source.container] as [string, string]]
          : []),
        [t('player.info.sourceResolution'), source.resolution ?? dash],
        [t('player.info.range'), source.hdr ? t('player.info.hdr') : t('player.info.sdr')],
      ],
    },
  ];

  return (
    <aside className="player-info" aria-label={t('player.info.title')} data-testid="player-info">
      <h2 className="player-info-title">{t('player.info.title')}</h2>
      {sections.map((section) => (
        <section key={section.title} className="player-info-section">
          <p className="player-menu-heading">{section.title}</p>
          <dl className="player-info-facts">
            {section.rows.map(([label, value]) => (
              <div key={label} className="player-info-fact">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </aside>
  );
}
