import { useT } from '../../i18n';
import { RowSkeleton } from '../../ui/media';
import { HERO_HEIGHT } from './layout';

/** The loading stand-in of a detail page: bars where the title, facts, synopsis and buttons go. */
export function DetailSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-label={t('detail.loading')} data-testid="detail-skeleton">
      <div className="detail-hero" style={{ height: HERO_HEIGHT }} aria-hidden="true">
        <div className="detail-hero-row">
          <div className="detail-poster" />
          <div className="detail-text">
            <div className="skeleton-bar detail-skeleton-title" />
            <div className="skeleton-bar detail-skeleton-meta" />
            <div className="skeleton-bar detail-skeleton-synopsis" />
            <div className="skeleton-bar detail-skeleton-play" />
          </div>
        </div>
      </div>
      <RowSkeleton shape="poster" />
    </div>
  );
}
