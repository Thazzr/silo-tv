import { useT } from '../../i18n';
import { formatClock } from '../format';
import { ScrubIcon } from './icons';
import {
  cardLeft,
  CARD_WIDTH_PLAIN,
  CARD_WIDTH_WITH_IMAGE,
  chapterTitleAt,
  thumbnailBox,
  type Chapter,
} from './previewMath';
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
  chapters: readonly Chapter[];
  scrub: { rate: number } | null;
}

/** A CSS url() token for a URL we do not control: quotes and backslashes cannot end it early. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

/**
 * The card above the scrubber: the thumbnail for `time` (one element, the sheet as its background),
 * the time and, inside a titled chapter, the chapter's name. Without previews it holds the time
 * and the chapter only. Only `transform` moves, so it stays on the compositor.
 */
export function PreviewCard({
  time,
  centerX,
  trackWidth,
  images,
  chapters,
  scrub,
}: PreviewCardProps) {
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
  const chapter = chapterTitleAt(chapters, time);
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
      {/* While scrubbing the time row carries the rate too, and the scrub's own test id. */}
      <p
        className="player-preview-time"
        data-testid={scrub ? 'player-scrub' : 'player-preview-time'}
        data-rate={scrub ? scrub.rate : undefined}
        aria-label={scrub ? t('player.osd.scrubbing', { rate: rateLabel }) : undefined}
      >
        {scrub ? (
          <>
            <ScrubIcon forward={scrub.rate > 0} />
            <span className="player-preview-rate">{rateLabel}</span>
          </>
        ) : null}
        <span>{formatClock(time)}</span>
      </p>
      {chapter ? (
        <p className="player-preview-chapter" data-testid="player-preview-chapter">
          {chapter}
        </p>
      ) : null}
    </div>
  );
}
