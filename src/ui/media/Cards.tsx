import type { ReactNode } from 'react';
import { Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { Artwork } from './Artwork';
import {
  cardSubtitle,
  cardTitle,
  landscapeArt,
  posterArt,
  watchedFraction,
  type CatalogItem,
} from './cardInfo';
import type { CardShape } from './layout';
import { useMediaUrl } from './useMediaUrl';

export interface CardProps {
  item: CatalogItem;
  /** Must be stable: focus memory finds the card by it. */
  focusKey: string;
  onOpen: (item: CatalogItem) => void;
  onFocused?: () => void;
  autoFocus?: boolean;
}

interface FrameProps {
  focusKey: string;
  variant: 'poster' | 'landscape' | 'grid';
  label?: string;
  onClick: () => void;
  onFocused?: () => void;
  autoFocus?: boolean;
  art: ReactNode;
  caption?: ReactNode;
}

/**
 * The focusable shell every card shares: a picture box with the focus ring and the shadow (both
 * only fade in, the scale is a transform) and a two-line caption below it. Focus changes only the
 * caption's colour, never its size, so a truncated title does not reflow.
 */
function CardFrame({
  focusKey,
  variant,
  label,
  onClick,
  onFocused,
  autoFocus,
  art,
  caption,
}: FrameProps) {
  return (
    <Focusable
      focusKey={focusKey}
      autoFocus={autoFocus}
      className={`card card-${variant}`}
      aria-label={label}
      onClick={onClick}
      onFocused={onFocused}
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

function Caption({ item }: { item: CatalogItem }) {
  const subtitle = cardSubtitle(item);
  return (
    <>
      <span className="card-title" data-testid="card-title">
        {cardTitle(item)}
      </span>
      <span className="card-sub" data-testid="card-sub">
        {subtitle}
      </span>
    </>
  );
}

/** A poster card: 176x264 in rows, 260x390 in browse grids. */
export function PosterCard({
  item,
  focusKey,
  onOpen,
  onFocused,
  autoFocus,
  grid = false,
}: CardProps & { grid?: boolean }) {
  const url = useMediaUrl();
  const art = posterArt(item);
  return (
    <CardFrame
      focusKey={focusKey}
      variant={grid ? 'grid' : 'poster'}
      onClick={() => onOpen(item)}
      onFocused={onFocused}
      autoFocus={autoFocus}
      art={<Artwork src={url(art.url)} thumbhash={art.thumbhash} title={cardTitle(item)} />}
      caption={<Caption item={item} />}
    />
  );
}

/**
 * A landscape card, 360x200, for Continue Watching, Next Up and other rows that are in progress:
 * a progress bar along the bottom edge shows how far the profile got.
 */
export function LandscapeCard({ item, focusKey, onOpen, onFocused, autoFocus }: CardProps) {
  const url = useMediaUrl();
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
          <Artwork src={url(art.url)} thumbhash={art.thumbhash} title={cardTitle(item)} />
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
      caption={<Caption item={item} />}
    />
  );
}

/** The last card of a row: opens the row's full grid. Same shape as its neighbours, no artwork. */
export function ExploreAllCard({
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
}
