import { memo, type KeyboardEventHandler, type ReactNode } from 'react';
import { Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { Artwork } from './Artwork';
import { CardBadges, ItemWatchStatus } from './CardBadges';
import {
  boxSetCaption,
  cardSubtitle,
  cardTitle,
  filmCountText,
  landscapeArt,
  posterArt,
  watchedFraction,
  wideCaption,
  type CatalogBoxSet,
  type CatalogItem,
} from './cardInfo';
import type { CardShape } from './layout';
import { protectsCardArt, useSpoilerSettings } from './spoilers';
import { useMediaUrl } from './useMediaUrl';

export interface CardProps {
  item: CatalogItem;
  /** Must be stable: focus memory finds the card by it. */
  focusKey: string;
  onOpen: (item: CatalogItem) => void;
  onFocused?: () => void;
  autoFocus?: boolean;
}

export interface FrameProps {
  focusKey: string;
  variant: 'poster' | 'landscape' | 'person' | 'grid';
  /** Extra class on the card, for a caption taller than the two lines the cards share. */
  className?: string;
  label?: string;
  onClick: () => void;
  onFocused?: () => void;
  /** Keys the card handles itself (the remote's Play key plays the card). */
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  autoFocus?: boolean;
  art: ReactNode;
  caption?: ReactNode;
}

/**
 * The focusable shell every card shares: a picture box with the focus ring and the shadow (both
 * only fade in, the scale is a transform) and a caption of two or three lines below it. Focus
 * changes only the caption's colour, never its size, so a truncated title does not reflow.
 */
export function CardFrame({
  focusKey,
  variant,
  className,
  label,
  onClick,
  onFocused,
  onKeyDown,
  autoFocus,
  art,
  caption,
}: FrameProps) {
  return (
    <Focusable
      focusKey={focusKey}
      autoFocus={autoFocus}
      className={`card card-${variant}${className ? ` ${className}` : ''}`}
      aria-label={label}
      onClick={onClick}
      onFocused={onFocused}
      onKeyDown={onKeyDown}
    >
      <span className="card-art">
        {art}
        <span className="card-shadow" aria-hidden="true" />
        <span className="card-ring" aria-hidden="true" />
      </span>
      {caption ? <span className="card-caption">{caption}</span> : null}
    </Focusable>
  );
}

/** The caption of a poster card: the title and, in the web's meta style, the year line. */
function PosterCaption({ item, subtitle }: { item: CatalogItem; subtitle?: string }) {
  const t = useT();
  return (
    <>
      <span className="card-title" data-testid="card-title">
        {cardTitle(item)}
      </span>
      <span className="card-sub card-sub-meta" data-testid="card-sub">
        {subtitle ?? cardSubtitle(item, t)}
      </span>
    </>
  );
}

/** The caption of a wide card: the title, "Season 4 Episode 7 • Title", then the time left. */
function WideCaption({ item }: { item: CatalogItem }) {
  const t = useT();
  const { episode, status } = wideCaption(item, t);
  return (
    <>
      <span className="card-title" data-testid="card-title">
        {cardTitle(item)}
      </span>
      {episode ? (
        <span className="card-sub" data-testid="card-episode">
          {episode}
        </span>
      ) : null}
      {status ? (
        <span className="card-sub" data-testid="card-status">
          {status}
        </span>
      ) : null}
    </>
  );
}

/**
 * A poster card: 185x278 in rows, 260x390 in browse grids. The cards are memoised: a focus move
 * redraws nothing in a card (the ring is CSS), so rows and grids skip the ones that did not change.
 */
export const PosterCard = memo(function PosterCard({
  item,
  focusKey,
  onOpen,
  onFocused,
  autoFocus,
  grid = false,
  badge,
  subtitle,
}: CardProps & { grid?: boolean; badge?: string; subtitle?: string }) {
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  const art = posterArt(item);
  return (
    <CardFrame
      focusKey={focusKey}
      variant={grid ? 'grid' : 'poster'}
      onClick={() => onOpen(item)}
      onFocused={onFocused}
      autoFocus={autoFocus}
      art={
        <>
          <Artwork
            src={url(art.url)}
            thumbhash={art.thumbhash}
            title={cardTitle(item)}
            protect={protectsCardArt(item, 'poster', spoilers)}
          />
          {badge ? <CardPill place="start" text={badge} /> : null}
          <CardBadges item={item} without={badge ? 'top-left' : undefined} />
          <ItemWatchStatus item={item} />
        </>
      }
      caption={<PosterCaption item={item} subtitle={subtitle} />}
    />
  );
});

/** A small label on the picture of a card: top left ("start") or bottom right ("end"). */
export function CardPill({ place, text }: { place: 'start' | 'end'; text: string }) {
  return (
    <span className={`card-pill card-pill-${place}`} data-testid={`card-pill-${place}`}>
      {text}
    </span>
  );
}

/**
 * A box set: a poster card with a "BOX SET" pill top left and the film count bottom right. The
 * caption says how far the profile got once a film is played, else the years, else the count.
 */
export const BoxSetCard = memo(function BoxSetCard({
  boxSet,
  focusKey,
  onOpen,
  onFocused,
  autoFocus,
  grid = false,
}: {
  boxSet: CatalogBoxSet;
  focusKey: string;
  onOpen: (boxSet: CatalogBoxSet) => void;
  onFocused?: () => void;
  autoFocus?: boolean;
  grid?: boolean;
}) {
  const t = useT();
  const url = useMediaUrl();
  const caption = boxSetCaption(boxSet, t);
  return (
    <CardFrame
      focusKey={focusKey}
      variant={grid ? 'grid' : 'poster'}
      label={`${caption.title}, ${caption.sub}`}
      onClick={() => onOpen(boxSet)}
      onFocused={onFocused}
      autoFocus={autoFocus}
      art={
        <>
          <Artwork
            src={url(boxSet.poster_url)}
            thumbhash={boxSet.poster_thumbhash}
            title={boxSet.title}
          />
          <CardPill place="start" text={t('boxset.badge')} />
          <CardPill place="end" text={filmCountText(boxSet.movie_count, t)} />
        </>
      }
      caption={
        <>
          <span className="card-title" data-testid="card-title">
            {caption.title}
          </span>
          <span className="card-sub" data-testid="card-sub">
            {caption.sub}
          </span>
        </>
      }
    />
  );
});

/**
 * A wide card, 315x177, for Continue Watching and Next Up: a progress bar along the bottom edge
 * shows how far the profile got, and three lines under it say what it is and how much is left.
 */
export const LandscapeCard = memo(function LandscapeCard({
  item,
  focusKey,
  onOpen,
  onFocused,
  autoFocus,
}: CardProps) {
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  const art = landscapeArt(item);
  const fraction = watchedFraction(item);
  return (
    <CardFrame
      focusKey={focusKey}
      variant="landscape"
      onClick={() => onOpen(item)}
      onFocused={onFocused}
      autoFocus={autoFocus}
      art={
        <>
          <Artwork
            src={url(art.url)}
            thumbhash={art.thumbhash}
            title={cardTitle(item)}
            protect={protectsCardArt(item, 'landscape', spoilers)}
          />
          <CardBadges item={item} raised={fraction !== null} />
          <ItemWatchStatus item={item} />
          {fraction !== null ? (
            <span className="card-progress" aria-hidden="true">
              <span
                className="card-progress-fill"
                data-testid="card-progress"
                style={{ width: `${Math.round(fraction * 1000) / 10}%` }}
              />
            </span>
          ) : null}
        </>
      }
      caption={<WideCaption item={item} />}
    />
  );
});

/** The last card of a row: opens the row's full grid. Same shape as its neighbours, no artwork. */
export const ExploreAllCard = memo(function ExploreAllCard({
  shape,
  rowTitle,
  focusKey,
  onOpen,
  onFocused,
}: {
  shape: CardShape;
  rowTitle: string;
  focusKey: string;
  onOpen: () => void;
  onFocused?: () => void;
}) {
  const t = useT();
  return (
    <CardFrame
      focusKey={focusKey}
      variant={shape}
      label={t('home.exploreAllOf', { title: rowTitle })}
      onClick={onOpen}
      onFocused={onFocused}
      art={
        <span className="art art-explore" data-testid="explore-all-art">
          <span className="explore-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30">
              <path
                d="M5 12h13M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="explore-label">{t('home.exploreAll')}</span>
        </span>
      }
    />
  );
});

/**
 * A person of the cast: the portrait on a poster-sized card with the name over the character.
 * Without a photo (or when it fails) the card shows the initials on a tile.
 */
export const PersonCard = memo(function PersonCard({
  name,
  role,
  photo,
  thumbhash,
  initials,
  focusKey,
  onOpen,
  onFocused,
  compact = false,
}: {
  name: string;
  role?: string;
  photo?: string;
  thumbhash?: string;
  initials: string;
  focusKey: string;
  onOpen: () => void;
  onFocused?: () => void;
  /** A round portrait with the name under it, for a row that has little room (Search). */
  compact?: boolean;
}) {
  const url = useMediaUrl();
  return (
    <CardFrame
      focusKey={focusKey}
      variant={compact ? 'person' : 'poster'}
      label={role ? `${name}, ${role}` : name}
      onClick={onOpen}
      onFocused={onFocused}
      art={<Artwork src={url(photo)} thumbhash={thumbhash} title={initials} />}
      caption={
        <>
          <span className="card-title" data-testid="card-title">
            {name}
          </span>
          <span className="card-sub" data-testid="card-sub">
            {role ?? ''}
          </span>
        </>
      }
    />
  );
});
