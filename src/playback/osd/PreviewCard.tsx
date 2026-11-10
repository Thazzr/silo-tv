import { useT } from '../../i18n';
import { formatClock } from '../format';
import { ScrubIcon } from './icons';
import { cardLeft, CARD_WIDTH_PLAIN, CARD_WIDTH_WITH_IMAGE, thumbnailBox } from './previewMath';
import type { TrickplayImages } from './useTrickplay';
import { useSheetPreload } from './useSheetPreload';

const NO_URLS: (string | null)[] = [];

export interface PreviewCardProps {
  /** The time the card shows: a pending skip, the scrub target or the pointer's position. */
  time: number;
  /** Where the card is centred, in pixels from the scrubber's left end. */
  centerX: number;
  trackWidth: number;
  images: TrickplayImages | undefined;
  scrub: { rate: number } | null;
}

/** A CSS url() token for a URL we do not control: quotes and backslashes cannot end it early. */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\n\r\\]/g, (c) => encodeURIComponent(c))}")`;
}

/**
 * The card above the scrubber: the thumbnail for `time` (one element, the sheet as its background)
 * flush at the top and a slim strip under it with the time and, while scrubbing, the rate. Without
 * previews it is the strip alone. Only `transform` moves, so it stays on the compositor.
 */
export function PreviewCard({ time, centerX, trackWidth, images, scrub }: PreviewCardProps) {
  const t = useT();
  const box = images ? thumbnailBox(time, images.manifest) : null;
  const url = box && images ? (images.sheetUrls[box.sheet] ?? null) : null;
  const withImage = box !== null && url !== null;
  useSheetPreload(
    withImage && images ? images.sheetUrls : NO_URLS,
    box?.sheet ?? 0,
    scrub ? (Math.sign(scrub.rate) as 1 | -1) : 0,
  );

  const width = withImage ? CARD_WIDTH_WITH_IMAGE : CARD_WIDTH_PLAIN;
  const rateLabel = scrub ? `${Math.abs(scrub.rate)}×` : '';

  return (
    <div
      className="player-preview"
      data-testid="player-preview"
      style={{ width, transform: `translateX(${cardLeft(centerX, width, trackWidth)}px)` }}
    >
      {withImage ? (
        <div
          className="player-preview-image"
          data-testid="player-preview-image"
          style={{
            width: box.width,
            height: box.height,
            backgroundImage: cssUrl(url),
            backgroundSize: box.backgroundSize,
            backgroundPosition: box.backgroundPosition,
          }}
        />
      ) : null}
      {/* While scrubbing the strip carries the rate too, and the scrub's own test id. */}
      <p
        className="player-preview-time"
        data-testid={scrub ? 'player-scrub' : 'player-preview-time'}
        data-rate={scrub ? scrub.rate : undefined}
        aria-label={scrub ? t('player.osd.scrubbing', { rate: rateLabel }) : undefined}
      >
        <span>{formatClock(time)}</span>
        {scrub ? (
          <span className="player-preview-rate" data-testid="player-preview-rate">
            <ScrubIcon forward={scrub.rate > 0} />
            <span>{rateLabel}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
