import { useT } from '../../i18n';
import { Button } from '../ui';

/**
 * The calm placeholder of the tabs that Phase 2 fills. The button is a real shortcut to Home and
 * keeps the content focusable, so Up and Down behave like on every other tab.
 */
export function ComingSoon({ onHome }: { onHome: () => void }) {
  const t = useT();
  return (
    <section className="coming-soon" data-testid="coming-soon">
      <h2 className="section-title">{t('shell.comingSoon.title')}</h2>
      <p className="note">{t('shell.comingSoon.text')}</p>
      <Button focusKey="shell-placeholder" onClick={onHome}>
        {t('shell.comingSoon.home')}
      </Button>
    </section>
  );
}
