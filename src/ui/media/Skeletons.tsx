import { useT } from '../../i18n';
import {
  cardBlockHeight,
  DEFAULT_GRID,
  type GridMetrics,
  rowHeight,
  rowStep,
  rowVisibleCards,
  ROW_INSET,
  STRIP_PADDING,
  type CardMetrics,
  type CardShape,
} from './layout';

/**
 * A card-shaped block: the picture box and the caption lines, as the real card has them (a wide
 * card has three).
 */
export function CardSkeleton({ shape }: { shape: CardShape | 'grid' }) {
  return (
    <span
      className={`card card-${shape} card-skeleton`}
      data-testid="card-skeleton"
      data-shape={shape}
    >
      <span className="card-art skeleton-block" />
      <span className="card-caption">
        <span className="skeleton-line skeleton-line-title" />
        <span className="skeleton-line skeleton-line-sub" />
        {shape === 'landscape' ? <span className="skeleton-line skeleton-line-sub" /> : null}
      </span>
    </span>
  );
}

/**
 * The loading stand-in of a row: a header bar and cards of the row's shape. A row that is not as
 * wide as the screen (the end screen's) passes its own card size, inset and the cards that fit.
 */
export function RowSkeleton({
  shape,
  metrics,
  inset = ROW_INSET,
  visibleCards,
}: {
  shape: CardShape;
  metrics?: CardMetrics;
  inset?: number;
  visibleCards?: number;
}) {
  const size = metrics ?? shape;
  const cards = (visibleCards ?? rowVisibleCards(size)) + 1;
  const step = rowStep(size);
  return (
    <section
      className="row-section row-skeleton"
      data-testid="row-skeleton"
      data-shape={shape}
      aria-hidden="true"
      style={{ height: rowHeight(size) }}
    >
      <div className="row-title skeleton-title" style={{ marginLeft: inset }} />
      <div className="row-strip" style={{ height: cardBlockHeight(size) + 2 * STRIP_PADDING }}>
        <div className="row-track" style={{ left: inset }}>
          {Array.from({ length: cards }, (_, i) => (
            <div className="row-slot" key={i} style={{ left: i * step }}>
              <CardSkeleton shape={shape} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The loading stand-in of a grid: two rows of posters in the grid's columns. */
export function GridSkeleton({ layout = DEFAULT_GRID }: { layout?: GridMetrics }) {
  const t = useT();
  const { columns, rowPitch } = layout;
  const rows = 2;
  const step = layout.card.width + layout.gap;
  return (
    <div
      className="grid-viewport"
      role="status"
      aria-label={t('home.grid.loading')}
      data-testid="grid-skeleton"
    >
      <div className="grid-track" style={{ left: layout.inset, height: rows * rowPitch }}>
        {Array.from({ length: rows * columns }, (_, i) => (
          <div
            className="grid-slot"
            key={i}
            style={{
              left: (i % columns) * step,
              top: Math.floor(i / columns) * rowPitch,
            }}
          >
            <CardSkeleton shape="grid" />
          </div>
        ))}
      </div>
    </div>
  );
}
