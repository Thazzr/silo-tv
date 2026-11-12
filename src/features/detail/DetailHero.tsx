import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../../app/ui';
import { useLanguage, useT } from '../../i18n';
import {
  Artwork,
  protectsEpisodeStill,
  thumbhashColor,
  thumbhashPreview,
  useMediaUrl,
  useSpoilerSettings,
} from '../../ui/media';
import { useProfileSetting } from '../settings/profileSettings';
import {
  detailChips,
  episodeChips,
  heroCredits,
  isEpisodeDetail,
  isSeason,
  isSeries,
  kicker,
  qualityBadges,
  ratingEntries,
  seasonLabel,
  seasonSubtitle,
  type HeroSynopsis,
  type ItemDetail,
  type Season,
} from './info';
import { coverHeight, fitSynopsisLines, SAFE_TOP } from './layout';
import type { FileVersion } from './versions';

/**
 * How many characters of 26 px text one line holds (the 1300 px text width). A synopsis longer
 * than `lines` of them is taken to be cut when the layout cannot say (it is measured wherever
 * there is a layout).
 */
const CHARS_PER_LINE = 100;

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
  protectedHash,
}: {
  /** The picture's address (already resolved against the server), or null for none. */
  backdrop: string | null;
  scrolled: boolean;
  /**
   * Set when spoiler protection covers the picture: the picture is never requested, and its
   * ThumbHash (the empty string when it has none) stands in, blurred by the browser's scaling.
   */
  protectedHash?: string;
}) {
  const preview = protectedHash === undefined ? null : thumbhashPreview(protectedHash);
  const color = protectedHash === undefined ? null : thumbhashColor(protectedHash);
  return (
    <div className="detail-backdrop-layer" data-testid="detail-backdrop-layer" aria-hidden="true">
      {protectedHash !== undefined ? (
        preview ? (
          <img
            className="detail-backdrop"
            data-testid="detail-backdrop-protected"
            src={preview}
            alt=""
          />
        ) : (
          <div
            className="detail-backdrop"
            data-testid="detail-backdrop-protected"
            style={color ? { backgroundColor: color } : undefined}
          />
        )
      ) : backdrop ? (
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

/**
 * The page's backdrop: the item's own, which for an episode is its still (large). An unwatched
 * episode's still gives the story away, so spoiler protection swaps it for its ThumbHash.
 */
export function DetailBackdrop({ detail, scrolled }: { detail: ItemDetail; scrolled: boolean }) {
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  const covered =
    isEpisodeDetail(detail) &&
    detail.backdrop_url !== undefined &&
    protectsEpisodeStill(
      { user_data: detail.user_data, still_is_episode_still: detail.backdrop_is_episode_still },
      spoilers,
    );
  return (
    <BackdropLayer
      backdrop={url(detail.backdrop_url)}
      scrolled={scrolled}
      protectedHash={covered ? (detail.backdrop_thumbhash ?? '') : undefined}
    />
  );
}

/**
 * The top of a detail page, like the web's hero, but laid out for a TV: the poster beside the title
 * block (the kicker, the title art or the title, the tagline, the chips and quality badges, the
 * external ratings), as tall as that block (at least 300 px), and below both, across the full
 * width, the synopsis, the credit line and the action row (`actions`). A season page has a breadcrumb in place
 * of the kicker, the series' title (or its logo) with the season's own title under it, and no
 * ratings or credits; its synopsis is the season's. An episode page has no poster (its still is
 * the backdrop), a breadcrumb (series, season, episode), the episode's title, its runtime and air
 * date, ratings, the series' synopsis when the episode has none, and its director and writers.
 */
export function DetailHero({
  detail,
  actions,
  onMore,
  faded = false,
  translation = null,
  seasons,
  loadedEpisodes = 0,
  version,
  synopsis,
  episodeSeason,
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
  /** A season's number of loaded episodes, for the chip when the season carries no count. */
  loadedEpisodes?: number;
  /** The selected file of a movie or episode: its runtime and quality badges are the page's. */
  version?: FileVersion;
  /** What the synopsis says (the item's description, or the series' for an episode without one). */
  synopsis: HeroSynopsis;
  /** An episode's season from the series' season list, for its label in the breadcrumb. */
  episodeSeason?: Season;
}) {
  const t = useT();
  const lang = useLanguage();
  const url = useMediaUrl();
  const [failed, setFailed] = useState<string | null>(null);
  const logo = url(detail.logo_url);
  const titleArt = useProfileSetting('ui.title_art');
  const hasLogo = logo !== null && failed !== logo;
  // Until the profile's choice is known the logo is neither shown nor requested; its box is
  // reserved (same size) so the page does not jump once the answer arrives.
  const showLogo = hasLogo && titleArt.known && titleArt.value;
  const reserveLogo = hasLogo && !titleArt.known;
  const season = isSeason(detail);
  const episode = isEpisodeDetail(detail);
  const { type, name: studio } = kicker(detail, t);
  const chips = episode
    ? episodeChips(detail, lang, t, version)
    : detailChips(detail, seasons, t, loadedEpisodes, version);
  const badges = qualityBadges(version);
  const ratings = season ? [] : ratingEntries(detail);
  const { credits, genres } = season ? { credits: [], genres: [] } : heroCredits(detail, t);
  // A season page is titled by its series; the season's own title is the line under it.
  const heading = season ? (detail.series_title ?? detail.title) : detail.title;
  const subtitle = season ? seasonSubtitle(detail, t) : episode ? null : (detail.tagline ?? null);
  // A season page's breadcrumb ends on the season, an episode page's on the episode.
  let crumbs: string[] | null = null;
  if (season) crumbs = [heading, seasonLabel(detail, t)];
  else if (episode) {
    crumbs = [
      ...(detail.series_title ? [detail.series_title] : []),
      seasonLabel(episodeSeason ?? { season_number: detail.season_number }, t),
      // An episode without a number has no "Episode N" crumb.
      ...(detail.episode_number === undefined
        ? []
        : [t('detail.episodeNumber', { episode: detail.episode_number })]),
    ];
  }
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

  // The synopsis gives way so the hero's last row (the pills, or the buttons) ends inside the
  // safe area; the text it cuts stays under "More". The web clamps a series, a season and an
  // episode to 3 lines and shows a movie's whole text on a page that scrolls; a TV page cannot
  // scroll that way, so a movie has at most 6 lines.
  const maxLines = series || season || episode ? 3 : 6;
  const [fitted, setFitted] = useState(maxLines);
  const textRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // The cover is as tall as the title block beside it (CSS cannot size a width from a stretched
  // height here). The logo box has a fixed size and the fonts are bundled, so the block's height
  // is known after the first layout; writing the style directly keeps it out of the render cycle.
  useLayoutEffect(() => {
    const height = headRef.current?.getBoundingClientRect().height ?? 0;
    gridRef.current?.style.setProperty('--cover-height', `${coverHeight(height)}px`);
  });
  // After every render, before the paint: the pills, the logo and the text all arrive by props.
  // The window is fixed at launch, the logo box has a fixed size and the fonts are bundled, so no
  // other event changes the layout. A fit that gives the same count sets the same state, which
  // ends the chain of renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const text = textRef.current;
    const para = text?.querySelector<HTMLElement>('.detail-synopsis:not(.detail-synopsis-hidden)');
    const last = text?.lastElementChild;
    const page = text?.closest('.detail-page');
    // Without a layout (the unit tests) every box is 0 px high: the full count stands.
    if (!text || !para || !last || !page || para.clientHeight === 0) return;
    const lineHeight = parseFloat(getComputedStyle(para).lineHeight);
    const bottom = last.getBoundingClientRect().bottom - page.getBoundingClientRect().top;
    setFitted(
      fitSynopsisLines({
        max: maxLines,
        rendered: Math.round(para.clientHeight / lineHeight),
        content: Math.round(para.scrollHeight / lineHeight),
        overflow: bottom - (window.innerHeight - SAFE_TOP),
        lineHeight,
        moreShown: text.querySelector('.detail-more') !== null,
      }),
    );
  });

  return (
    <div className="detail-hero" data-testid="detail-hero">
      <div
        ref={gridRef}
        className={episode ? 'detail-hero-grid' : 'detail-hero-grid detail-has-poster'}
      >
        {episode ? null : (
          <div className="detail-poster" data-testid="detail-poster" data-faded={faded}>
            <Artwork
              src={url(detail.poster_url)}
              thumbhash={detail.poster_thumbhash}
              title={season ? seasonLabel(detail, t) : detail.title}
            />
          </div>
        )}
        <div ref={headRef} className="detail-text detail-head" data-faded={faded}>
          {crumbs ? (
            <nav
              className="detail-breadcrumb"
              aria-label={t('detail.breadcrumb')}
              data-testid="detail-breadcrumb"
            >
              {crumbs.map((crumb, index) => (
                <Fragment key={index}>
                  {index > 0 ? <ChevronRight size={22} aria-hidden="true" /> : null}
                  <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>
                    {crumb}
                  </span>
                </Fragment>
              ))}
            </nav>
          ) : (
            <p className="detail-kicker" data-testid="detail-kicker">
              {type}
              {studio ? (
                <>
                  <span className="detail-kicker-dot" aria-hidden="true" />
                  <span className="detail-kicker-name">{studio}</span>
                </>
              ) : null}
            </p>
          )}
          {reserveLogo ? (
            <div className="detail-logo" data-testid="detail-logo-reserve" />
          ) : showLogo ? (
            <img
              className="detail-logo"
              data-testid="detail-logo"
              src={logo}
              alt={heading}
              onError={() => setFailed(logo)}
            />
          ) : (
            <h1 className="detail-title" data-testid="detail-title">
              {heading}
            </h1>
          )}
          {subtitle ? (
            <p
              className={season ? 'detail-subtitle' : 'detail-tagline'}
              data-testid={season ? 'detail-subtitle' : 'detail-tagline'}
            >
              {subtitle}
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
        </div>
        <div ref={textRef} className="detail-text detail-body" data-faded={faded}>
          {synopsis.text ? (
            <Synopsis
              text={synopsis.text}
              onMore={onMore}
              lines={fitted}
              dimmed={translation === 'translating'}
            />
          ) : null}
          {synopsis.hidden ? (
            <p
              className="detail-synopsis detail-synopsis-hidden"
              data-testid="detail-synopsis-hidden"
            >
              {t('detail.descriptionHidden')}
            </p>
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
