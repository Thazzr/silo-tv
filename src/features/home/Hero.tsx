import { useEffect, useMemo, useState } from 'react';
import { useLanguage, useT, type MessageKey } from '../../i18n';
import { useProfileSetting } from '../settings/profileSettings';
import {
  cardTitle,
  heroProtection,
  useMediaUrl,
  useSpoilerSettings,
  wideCaption,
  type CatalogItem,
} from '../../ui/media';
import { Carousel, HeroError } from './Carousel';
import { heroMeta } from './heroMeta';

/** How long the focus must rest on a card before the hero follows it. */
export const HERO_REST_MS = 250;

/**
 * Follows `value` once it has stopped changing for `restMs`. The first value is taken at once,
 * so the hero is never empty; so is a value after `null`, and `null` itself, so a hero that
 * lets go of its card and picks one up again does not show the old one in between. While the
 * focus runs across cards nothing is replaced.
 */
export function useRestedValue<T>(value: T | null, restMs: number): T | null {
  const [rested, setRested] = useState(value);
  if ((value === null || rested === null) && value !== rested) setRested(value);
  useEffect(() => {
    if (value === rested) return;
    const id = setTimeout(() => setRested(value), restMs);
    return () => clearTimeout(id);
  }, [value, rested, restMs]);
  return rested;
}

/** What the featured section of a screen gives the hero. */
export type Featured =
  | { kind: 'loading' }
  /** `text` is the message above "Retry section"; `onRetry` reads the section again. */
  | { kind: 'error'; text: MessageKey; onRetry: () => void }
  | {
      kind: 'slides';
      slides: readonly CatalogItem[];
      /** "Play" of a slide, and the remote's Play key. */
      onPlay: (item: CatalogItem) => void;
      /** "More Info" of a slide. */
      onOpen: (item: CatalogItem) => void;
    };

/**
 * The top of Home and of a library's Recommended view. It has two modes.
 * - Without `item` it is the featured carousel (when the screen has a featured section): the
 *   slides, their title, meta line and synopsis, "Play", "More Info" and the slide indicator.
 * - With an `item`, the card that has the focus in the rows below, it shows that card instead:
 *   its backdrop, its title art (or title), a meta line and a synopsis, display only. For an
 *   episode it shows the series' art, since the episode's own pictures are stills. A `wide` card
 *   (Continue Watching, Next Up) adds the lines its caption has: the episode line and the time
 *   left. It changes after the focus has rested on a card, so scrolling quickly through a row
 *   does not decode a picture per card.
 * The carousel stays mounted under the card (invisible), so the focus can go back up to its
 * buttons and the slide it showed is still the one it shows. A screen without a featured section
 * has the card mode only.
 */
export function Hero({
  item,
  wide = false,
  featured = null,
  restMs = HERO_REST_MS,
}: {
  item: CatalogItem | null;
  /** The card is a wide one: its row shows the episode line and the time left under it. */
  wide?: boolean;
  featured?: Featured | null;
  restMs?: number;
}) {
  // The card and its kind rest together, so a card never shows the lines of the previous kind.
  const card = useMemo(() => (item ? { item, wide } : null), [item, wide]);
  const shown = useRestedValue(card, restMs);
  let carousel = null;
  if (featured?.kind === 'slides') {
    carousel = (
      <Carousel
        slides={featured.slides}
        shown={item === null}
        onPlay={featured.onPlay}
        onOpen={featured.onOpen}
      />
    );
  } else if (featured?.kind === 'error') {
    carousel = <HeroError text={featured.text} onRetry={featured.onRetry} />;
  } else if (featured?.kind === 'loading' && item === null) {
    return <HeroSkeleton />;
  }
  return (
    <div className="hero" data-testid="hero" data-content-id={shown?.item.content_id}>
      {carousel}
      {shown ? <FocusedCard item={shown.item} wide={shown.wide} /> : null}
    </div>
  );
}

function FocusedCard({ item, wide }: { item: CatalogItem; wide: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const url = useMediaUrl();
  const titleArt = useProfileSetting('ui.title_art');
  const spoilers = useSpoilerSettings();
  const [failed, setFailed] = useState<string | null>(null);

  const episode = item.type.trim().toLowerCase() === 'episode';
  // An unwatched episode's own still would give the story away: the backdrop is then left out.
  const hidden = heroProtection(item, spoilers);
  const backdrop = hidden.hideBackdrop
    ? null
    : url(
        (episode ? (item.series_backdrop_url ?? item.backdrop_url) : item.backdrop_url) ??
          undefined,
      );
  const logo = url(item.logo_url);
  const title = cardTitle(item);
  const hasLogo = logo !== null && failed !== logo;
  // Until the profile's choice is known the logo is neither shown nor requested; its box is
  // reserved so the text below does not jump once the answer arrives.
  const showLogo = hasLogo && titleArt.known && titleArt.value;
  const reserveLogo = hasLogo && !titleArt.known;
  const meta = heroMeta(item, { t, lang });
  const { episode: episodeLine, status } = wide
    ? wideCaption(item, t)
    : { episode: null, status: null };

  return (
    <div className="hero-card" data-testid="hero-card">
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
        {reserveLogo ? (
          <div className="hero-logo hero-logo-reserve" data-testid="hero-logo-reserve" />
        ) : showLogo ? (
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
        {episodeLine ? (
          <p className="hero-meta" data-testid="hero-episode">
            {episodeLine}
          </p>
        ) : null}
        {status ? (
          <p className="hero-meta" data-testid="hero-status">
            {status}
          </p>
        ) : null}
        {item.overview && !hidden.hideOverview ? (
          <p className="hero-synopsis" data-testid="hero-synopsis">
            {item.overview}
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
