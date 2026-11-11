import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { Artwork, useMediaUrl } from '../../ui/media';
import { useProfileSetting } from '../settings/profileSettings';
import {
  detailChips,
  heroCredits,
  isSeries,
  kicker,
  qualityBadges,
  ratingEntries,
  type ItemDetail,
  type Season,
} from './info';

/**
 * How many characters of 26 px text one line holds (an 800 to 900 px column). A synopsis longer
 * than `lines` of them is taken to be cut when the layout cannot say (it is measured wherever
 * there is a layout).
 */
const CHARS_PER_LINE = 60;

/** The synopsis, at most `lines` lines, with "More" under it when the text goes on. */
export function Synopsis({
  text,
  onMore,
  lines = 4,
  dimmed = false,
}: {
  text: string;
  onMore: () => void;
  /** How many lines are shown before the text is cut. */
  lines?: number;
  /** The text is being translated: it is drawn dimmer (by its colour, not by opacity). */
  dimmed?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [measured, setMeasured] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Without a layout (the unit tests) every box is 0 px high: the length estimate stands.
    if (el && el.clientHeight > 0) setMeasured(el.scrollHeight > el.clientHeight + 1);
    else setMeasured(null);
  }, [text, lines]);
  const clamped = measured ?? text.length > lines * CHARS_PER_LINE;
  return (
    <>
      <p
        ref={ref}
        className="detail-synopsis"
        data-testid="detail-synopsis"
        data-dimmed={dimmed}
        style={{ WebkitLineClamp: lines }}
      >
        {text}
      </p>
      {clamped ? (
        <Button focusKey="detail-more" className="detail-more" onClick={onMore}>
          {t('detail.more')}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The picture behind the whole page. It stays where it is while the content scrolls over it, and
 * it is darkened further once the page has left the hero so cards and rows stay readable.
 */
export function BackdropLayer({
  backdrop,
  scrolled,
}: {
  /** The picture's address (already resolved against the server), or null for none. */
  backdrop: string | null;
  scrolled: boolean;
}) {
  return (
    <div className="detail-backdrop-layer" data-testid="detail-backdrop-layer" aria-hidden="true">
      {backdrop ? (
        <img
          className="detail-backdrop"
          data-testid="detail-backdrop"
          src={backdrop}
          alt=""
          decoding="async"
        />
      ) : null}
      <div className="detail-shade" />
      <div className="detail-dim" data-scrolled={scrolled} data-testid="detail-dim" />
    </div>
  );
}

export function DetailBackdrop({ detail, scrolled }: { detail: ItemDetail; scrolled: boolean }) {
  const url = useMediaUrl();
  return <BackdropLayer backdrop={url(detail.backdrop_url)} scrolled={scrolled} />;
}

/**
 * The top of a detail page, like the web's hero: the poster beside a column with the kicker, the
 * title art or the title, the tagline, the chips and quality badges, the external ratings, the
 * synopsis, the credit line and the action row (`actions`).
 */
export function DetailHero({
  detail,
  actions,
  onMore,
  faded = false,
  translation = null,
  seasons,
}: {
  detail: ItemDetail;
  actions: ReactNode;
  onMore: () => void;
  /** The focus is further down: the text column fades out so nothing is half cut at the top. */
  faded?: boolean;
  /** The line under the synopsis: the description is being translated, or was translated by AI. */
  translation?: 'translating' | 'ai' | null;
  /** A series' season list, which its season and episode chips count; empty while it loads. */
  seasons: readonly Season[];
}) {
  const t = useT();
  const url = useMediaUrl();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = url(detail.logo_url);
  const titleArt = useProfileSetting('ui.title_art');
  const hasLogo = logo !== null && failed !== logo;
  // Until the profile's choice is known the logo is neither shown nor requested; its box is
  // reserved (same size) so the page does not jump once the answer arrives.
  const showLogo = hasLogo && titleArt.known && titleArt.value;
  const reserveLogo = hasLogo && !titleArt.known;
  const { type, name: studio } = kicker(detail, t);
  const chips = detailChips(detail, seasons, t);
  const badges = qualityBadges(detail);
  const ratings = ratingEntries(detail);
  const { credits, genres } = heroCredits(detail, t);
  // The credit line's pieces, joined by dots: the credits, then all genres as one piece.
  const creditPieces: ReactNode[] = credits.map((credit) => (
    <Fragment key={credit.label}>
      <span className="detail-credit-label">{credit.label}</span>{' '}
      <span className="detail-credit-names">{credit.names}</span>
    </Fragment>
  ));
  if (genres.length > 0) {
    creditPieces.push(
      <span key="genres" className="detail-credit-names">
        {genres.join(' · ')}
      </span>,
    );
  }
  const series = isSeries(detail);

  return (
    <div className="detail-hero" data-testid="detail-hero">
      <div className="detail-hero-row">
        <div className="detail-poster" data-testid="detail-poster" data-faded={faded}>
          <Artwork
            src={url(detail.poster_url)}
            thumbhash={detail.poster_thumbhash}
            title={detail.title}
          />
        </div>
        <div className="detail-text" data-faded={faded}>
          <p className="detail-kicker" data-testid="detail-kicker">
            {type}
            {studio ? (
              <>
                <span className="detail-kicker-dot" aria-hidden="true" />
                <span className="detail-kicker-name">{studio}</span>
              </>
            ) : null}
          </p>
          {reserveLogo ? (
            <div className="detail-logo" data-testid="detail-logo-reserve" />
          ) : showLogo ? (
            <img
              className="detail-logo"
              data-testid="detail-logo"
              src={logo}
              alt={detail.title}
              onError={() => setFailed(logo)}
            />
          ) : (
            <h1 className="detail-title" data-testid="detail-title">
              {detail.title}
            </h1>
          )}
          {detail.tagline ? (
            <p className="detail-tagline" data-testid="detail-tagline">
              {detail.tagline}
            </p>
          ) : null}
          {chips.length > 0 || badges.length > 0 ? (
            <div className="detail-chiprow">
              <ul className="detail-chips" data-testid="detail-chips">
                {chips.map((chip) => (
                  <li key={chip} className="detail-chip">
                    {chip}
                  </li>
                ))}
              </ul>
              {badges.length > 0 ? (
                <ul
                  className="detail-badges"
                  data-testid="detail-badges"
                  aria-label={t('detail.quality')}
                >
                  {badges.map((badge) => (
                    <li key={badge} className="detail-badge">
                      {badge}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {ratings.length > 0 ? (
            <ul className="detail-ratings" data-testid="detail-ratings">
              {ratings.map((rating) => (
                <li key={rating.key}>
                  <span className="detail-rating-name">{rating.name}</span>{' '}
                  <span className="detail-rating-value">{rating.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {detail.overview ? (
            <Synopsis
              text={detail.overview}
              onMore={onMore}
              lines={series ? 3 : 6}
              dimmed={translation === 'translating'}
            />
          ) : null}
          {translation ? (
            <p className="detail-translation" data-testid="detail-translation">
              {t(translation === 'translating' ? 'detail.translating' : 'detail.translatedByAi')}
            </p>
          ) : null}
          {creditPieces.length > 0 ? (
            <p className="detail-credits" data-testid="detail-credits">
              {creditPieces.map((piece, index) => (
                <Fragment key={index}>
                  {index > 0 ? <span className="detail-credit-sep">{' · '}</span> : null}
                  {piece}
                </Fragment>
              ))}
            </p>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}
