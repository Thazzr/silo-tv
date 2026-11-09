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
  type CardShape,
} from './layout';

/** A card-shaped block: the picture box and the two caption lines, as the real card has them. */
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
      </span>
    </span>
  );
}

/** The loading stand-in of a row: a header bar and cards of the row's shape. */
export function RowSkeleton({ shape }: { shape: CardShape }) {
  const cards = rowVisibleCards(shape) + 1;
  const step = rowStep(shape);
  return (
    <section
      className="row-section row-skeleton"
      data-testid="row-skeleton"
      data-shape={shape}
      aria-hidden="true"
      style={{ height: rowHeight(shape) }}
    >
      <div className="row-title skeleton-title" />
      <div className="row-strip" style={{ height: cardBlockHeight(shape) + 2 * STRIP_PADDING }}>
        <div className="row-track" style={{ left: ROW_INSET }}>
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
