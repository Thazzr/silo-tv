import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { useMediaUrl } from '../../ui/media';
import { creditLine, metaLine, qualityBadges, ratingEntries, type ItemDetail } from './info';

/**
 * A synopsis longer than this many characters is taken to be cut at four lines when the layout
 * cannot say (it is measured wherever there is a layout): 26 px text in a 900 px column.
 */
const FOUR_LINES_CHARS = 275;

/** The synopsis, at most four lines, with "More" under it when the text goes on. */
export function Synopsis({ text, onMore }: { text: string; onMore: () => void }) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [measured, setMeasured] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Without a layout (the unit tests) every box is 0 px high: the length estimate stands.
    if (el && el.clientHeight > 0) setMeasured(el.scrollHeight > el.clientHeight + 1);
    else setMeasured(null);
  }, [text]);
  const clamped = measured ?? text.length > FOUR_LINES_CHARS;
  return (
    <>
      <p ref={ref} className="detail-synopsis" data-testid="detail-synopsis">
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
 * The top of a detail page: the title art or the title, the metadata line, quality badges and
 * external ratings, the synopsis, the credit line and the action row (`actions`).
 */
export function DetailHero({
  detail,
  actions,
  onMore,
  faded = false,
}: {
  detail: ItemDetail;
  actions: ReactNode;
  onMore: () => void;
  /** The focus is further down: the text column fades out so nothing is half cut at the top. */
  faded?: boolean;
}) {
  const t = useT();
  const url = useMediaUrl();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = url(detail.logo_url);
  const showLogo = logo !== null && failed !== logo;
  const meta = metaLine(detail, t);
  const badges = qualityBadges(detail);
  const ratings = ratingEntries(detail);
  const credits = creditLine(detail, t);

  return (
    <div className="detail-hero" data-testid="detail-hero">
      <div className="detail-text" data-faded={faded}>
        {showLogo ? (
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
        {meta ? (
          <p className="detail-meta" data-testid="detail-meta">
            {meta}
          </p>
        ) : null}
        {badges.length > 0 || ratings.length > 0 ? (
          <div className="detail-facts">
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
            {ratings.length > 0 ? (
              <ul className="detail-ratings" data-testid="detail-ratings">
                {ratings.map((rating) => (
                  <li key={rating.key}>{rating.text}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {detail.overview ? <Synopsis text={detail.overview} onMore={onMore} /> : null}
        {credits ? (
          <p className="detail-credits" data-testid="detail-credits">
            {credits}
          </p>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
