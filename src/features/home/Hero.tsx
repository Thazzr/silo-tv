import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { cardTitle, episodeLabel, useMediaUrl, type CatalogItem } from '../../ui/media';

/** How long the focus must rest on a card before the hero follows it. */
export const HERO_REST_MS = 250;

/**
 * Follows `value` once it has stopped changing for `restMs`. The first value is taken at once,
 * so the hero is never empty; while the focus runs across cards nothing is replaced.
 */
export function useRestedValue<T>(value: T, restMs: number): T {
  const [rested, setRested] = useState(value);
  useEffect(() => {
    if (value === rested) return;
    const id = setTimeout(() => setRested(value), restMs);
    return () => clearTimeout(id);
  }, [value, rested, restMs]);
  return rested;
}

function runtimeText(minutes: number, t: ReturnType<typeof useT>): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('media.runtime.minutes', { m });
  return m === 0 ? t('media.runtime.hours', { h }) : t('media.runtime.hoursMinutes', { h, m });
}

/** Year, runtime (or the episode number) and the content rating, in that order. */
export function heroMeta(item: CatalogItem, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  const label = episodeLabel(item);
  if (label) parts.push(label);
  else if (item.year) parts.push(String(item.year));
  if (item.runtime && item.runtime > 0) parts.push(runtimeText(item.runtime, t));
  if (item.content_rating) parts.push(item.content_rating);
  return parts.join(' · ');
}

/**
 * The top of Home: the backdrop of the card that has the focus, its title art (or its title),
 * a meta line and a two-line synopsis. It is display only. For an episode it shows the series'
 * art, since the episode's own pictures are stills. It changes after the focus has rested on a
 * card, so scrolling quickly through a row does not decode a picture per card.
 */
export function Hero({
  item,
  restMs = HERO_REST_MS,
}: {
  item: CatalogItem | null;
  restMs?: number;
}) {
  const t = useT();
  const url = useMediaUrl();
  const shown = useRestedValue(item, restMs);
  const [failed, setFailed] = useState<string | null>(null);
  if (!shown) return <div className="hero" data-testid="hero" />;

  const episode = shown.type.trim().toLowerCase() === 'episode';
  const backdrop = url(
    (episode ? (shown.series_backdrop_url ?? shown.backdrop_url) : shown.backdrop_url) ?? undefined,
  );
  const logo = url(shown.logo_url);
  const title = cardTitle(shown);
  const showLogo = logo !== null && failed !== logo;
  const meta = heroMeta(shown, t);

  return (
    <div className="hero" data-testid="hero" data-content-id={shown.content_id}>
      {backdrop ? (
        <img
          key={backdrop}
          className="hero-backdrop"
          data-testid="hero-backdrop"
          src={backdrop}
          alt=""
          decoding="async"
        />
      ) : null}
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-text">
        {showLogo ? (
          <img
            className="hero-logo"
            data-testid="hero-logo"
            src={logo}
            alt={title}
            onError={() => setFailed(logo)}
          />
        ) : (
          <h2 className="hero-title" data-testid="hero-title">
            {title}
          </h2>
        )}
        {meta ? (
          <p className="hero-meta" data-testid="hero-meta">
            {meta}
          </p>
        ) : null}
        {shown.overview ? (
          <p className="hero-synopsis" data-testid="hero-synopsis">
            {shown.overview}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The loading stand-in of the hero: bars where the title, the meta line and the synopsis go. */
export function HeroSkeleton() {
  return (
    <div className="hero hero-skeleton" data-testid="hero-skeleton" aria-hidden="true">
      <div className="hero-text">
        <div className="skeleton-bar hero-skeleton-title" />
        <div className="skeleton-bar hero-skeleton-meta" />
        <div className="skeleton-bar hero-skeleton-synopsis" />
      </div>
    </div>
  );
}
