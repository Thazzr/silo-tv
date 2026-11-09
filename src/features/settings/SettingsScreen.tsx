import { useState } from 'react';
import { FocusGroup, Focusable } from '../../app/nav';
import { Screen } from '../../app/ui';
import { useT } from '../../i18n';
import { REWIND_CHOICES, getResumeRewind, setResumeRewind } from '../../playback/resumeRewind';

const pillKey = (seconds: number) => `settings-rewind-${seconds}`;

/**
 * The device settings. Today one: how far playback jumps back when it resumes. Like the tabs,
 * focus and hover only move the highlight; OK or a click selects and saves at once. The value is
 * kept on this device only (see `resumeRewind`).
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [rewind, setRewind] = useState(getResumeRewind);
  // A stored value in range that is not a choice marks no pill; focus then starts on the first.
  const marked = REWIND_CHOICES.find((seconds) => seconds === rewind);
  const start = marked ?? REWIND_CHOICES[0];

  const pick = (seconds: number) => {
    setResumeRewind(seconds);
    setRewind(seconds);
  };

  return (
    <Screen title={t('settings.title')} onBack={onBack} testId="settings-screen">
      <section className="settings-section" aria-labelledby="settings-playback">
        <h2 id="settings-playback">{t('settings.playback')}</h2>
        <p className="settings-name" id="settings-rewind-label">
          {t('settings.rewind.title')}
        </p>
        <p className="settings-hint">{t('settings.rewind.hint')}</p>
        <FocusGroup
          focusKey="settings-rewind"
          enterable
          saveLastFocusedChild={false}
          preferredChildFocusKey={pillKey(start)}
          className="settings-choices"
          role="radiogroup"
          aria-labelledby="settings-rewind-label"
          data-testid="settings-rewind"
        >
          {REWIND_CHOICES.map((seconds) => (
            <Focusable
              key={seconds}
              focusKey={pillKey(seconds)}
              autoFocus={seconds === start}
              className={`btn choice settings-pill${seconds === marked ? ' selected' : ''}`}
              role="radio"
              aria-checked={seconds === marked}
              onClick={() => pick(seconds)}
            >
              {seconds === 0 ? t('settings.rewind.off') : t('settings.rewind.seconds', { seconds })}
            </Focusable>
          ))}
        </FocusGroup>
      </section>
    </Screen>
  );
}
