import { useT } from '../../i18n';

/** The heading line of the seasons row and the episode grid: the title, and "N total" once it is known. */
export function SectionHead({
  title,
  count,
  testId,
}: {
  title: string;
  count?: number;
  testId: string;
}) {
  const t = useT();
  return (
    <div className="detail-section-head" data-testid={testId}>
      <h2 className="detail-section-title">{title}</h2>
      {count === undefined ? null : (
        <span className="detail-section-total" data-testid={`${testId}-total`}>
          {t('detail.total', { count })}
        </span>
      )}
    </div>
  );
}
