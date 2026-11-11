import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useT, type MessageKey } from '../../i18n';
import { formatClock } from '../format';
import type { Segment, SegmentKind } from '../skip/segments';
import {
  cardLeft,
  CARD_WIDTH_PLAIN,
  CARD_WIDTH_WIDE,
  notchLeft,
  thumbnailBox,
} from './previewMath';
import type { TrickplayImages } from './useTrickplay';
import { useSheetPreload } from './useSheetPreload';

const NO_URLS: (string | null)[] = [];

/** The segments' names, as Silo's web player words them. */
const SEGMENT_NAME: Record<SegmentKind, MessageKey> = {
  intro: 'player.seek.segment.intro',
  recap: 'player.seek.segment.recap',
  credits: 'player.seek.segment.credits',
  preview: 'player.seek.segment.preview',
};

export interface PreviewCardProps {
  /** The time the card shows: a pending skip, the scrub target or the pointer's position. */
  time: number;
  /** Where the card is centred, in pixels from the scrubber's left end. */
  centerX: number;
  trackWidth: number;
  images: TrickplayImages | undefined;
  scrub: { rate: number } | null;
  /** The name of the chapter that holds `time`; null without chapters. */
  chapterTitle: string | null;
  /** The marker segment that holds `time`, if one does. */
  segment: Segment | null;
}

/** A CSS url() token for a URL we do not control: quotes and backslashes cannot end it early. */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\n\r\\]/g, (c) => encodeURIComponent(c))}")`;
}

/**
 * The card above the scrubber, as Silo's web player draws it: the thumbnail for `time` (one
 * element, the sheet as its background) on top, then, if `time` lies in a segment, its dot, name
 * and range, then the time (with the rate while scrubbing) and the chapter's name, and a notch
 * under it that stays on the time when the card is held at an edge. Only `transform` moves.
 */
export function PreviewCard({
  time,
  centerX,
  trackWidth,
  images,
  scrub,
  chapterTitle,
  segment,
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

  const wide = withImage || chapterTitle !== null || segment !== null;
  const width = wide ? CARD_WIDTH_WIDE : CARD_WIDTH_PLAIN;
  const left = cardLeft(centerX, width, trackWidth);
  const rateLabel = scrub ? `${Math.abs(scrub.rate)}×` : '';

  return (
    <div
      className="player-preview"
      data-testid="player-preview"
      style={{ width, transform: `translateX(${left}px)` }}
    >
      <div className="player-preview-card">
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
        <div className="player-preview-text">
          {segment ? (
            <p className="player-preview-segment" data-testid="player-preview-segment">
              <span
                className="player-preview-dot"
                data-kind={segment.kind}
                data-testid="player-preview-dot"
              />
              <span
                className="player-preview-segment-name"
                data-testid="player-preview-segment-name"
              >
                {t(SEGMENT_NAME[segment.kind])}
              </span>
              <span className="player-preview-range" data-testid="player-preview-range">
                {t('player.seek.range', {
                  from: formatClock(segment.start),
                  to: formatClock(segment.end),
                })}
              </span>
            </p>
          ) : null}
          {/* While scrubbing the line carries the rate too, and the scrub's own test id. */}
          <p
            className="player-preview-time"
            data-testid={scrub ? 'player-scrub' : 'player-preview-time'}
            data-rate={scrub ? scrub.rate : undefined}
            aria-label={scrub ? t('player.osd.scrubbing', { rate: rateLabel }) : undefined}
          >
            <span>{formatClock(time)}</span>
            {scrub ? (
              <span className="player-preview-rate" data-testid="player-preview-rate">
                {scrub.rate > 0 ? <ChevronsRight size={24} /> : <ChevronsLeft size={24} />}
                <span>{rateLabel}</span>
              </span>
            ) : null}
          </p>
          {chapterTitle ? (
            <p className="player-preview-chapter" data-testid="player-preview-chapter">
              {chapterTitle}
            </p>
          ) : null}
        </div>
      </div>
      <div
        className="player-preview-notch"
        data-testid="player-preview-notch"
        style={{ left: notchLeft(centerX, left, width) }}
      />
    </div>
  );
}
