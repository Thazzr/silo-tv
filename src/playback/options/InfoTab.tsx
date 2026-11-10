import { useT, type MessageKey } from '../../i18n';
import { runtimeLabel } from '../../features/detail/info';
import type { Chapter } from '../osd/previewMath';
import type { Heading, MediaFacts, Plan } from '../usePlaybackSession';
import { audioText, currentChapter, routeOf, subtitleText, videoText, type Route } from './info';

const ROUTE_TEXT: Record<Route, MessageKey> = {
  direct: 'player.options.info.routeDirect',
  remux: 'player.options.info.routeRemux',
  transcode: 'player.options.info.routeTranscode',
};

/** The episode's numbers as "S1 · E2"; null for anything else. */
function episodeCode(heading: Heading | null): string | null {
  const parts: string[] = [];
  if (heading?.seasonNumber !== undefined) parts.push(`S${heading.seasonNumber}`);
  if (heading?.episodeNumber !== undefined) parts.push(`E${heading.episodeNumber}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** What plays and how it reaches the TV: no interactive rows, and no path, URL or token. */
export function InfoTab({
  heading,
  title,
  plan,
  media,
  chapters,
  position,
}: {
  heading: Heading | null;
  title: string;
  plan: Plan;
  media: MediaFacts;
  chapters: readonly Chapter[];
  position: number;
}) {
  const t = useT();
  const seconds = plan.source.duration_seconds;
  const runtime = seconds ? runtimeLabel(Math.round(seconds / 60), t) : null;
  const when = [media.year ? String(media.year) : null, runtime].filter(Boolean).join(' · ');
  const route = routeOf(plan.delivery);
  const audio = audioText(plan, media);
  const subtitle = subtitleText(plan, media);
  const chapter = currentChapter(chapters, position);

  const rows: [string, string][] = [
    [t('player.options.info.route'), route ? t(ROUTE_TEXT[route]) : plan.delivery],
  ];
  const video = videoText(plan, media);
  if (video) rows.push([t('player.options.info.video'), video]);
  if (audio) rows.push([t('player.options.info.audio'), audio]);
  rows.push([
    t('player.options.info.subtitles'),
    subtitle ? (subtitle.label ?? t('player.options.on')) : t('player.options.off'),
  ]);
  if (chapters.length > 0 && chapter >= 0) {
    const current = chapters[chapter]!;
    rows.push([
      t('player.options.info.chapter'),
      current.title.trim() || t('player.options.chapterN', { n: chapter + 1 }),
    ]);
  }

  const code = episodeCode(heading);
  return (
    <div data-testid="options-info">
      <section className="player-options-section">
        <p className="lib-panel-heading">{t('player.options.info.title')}</p>
        {heading?.seriesTitle ? (
          <p className="player-options-series">{heading.seriesTitle}</p>
        ) : null}
        <p className="player-options-title">{heading?.title ?? title}</p>
        {code ? <p className="player-options-series">{code}</p> : null}
        {when ? <p className="player-options-series">{when}</p> : null}
      </section>
      <section className="player-options-section">
        <p className="lib-panel-heading">{t('player.options.info.stream')}</p>
        <dl className="player-options-facts">
          {rows.map(([label, value]) => (
            <div key={label} className="player-options-fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
