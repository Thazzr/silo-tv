import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { FocusGroup, Focusable } from '../../app/nav';
import { Button, Screen } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';
import {
  LANGUAGE_CHOICES,
  getLanguageSetting,
  setLanguageSetting,
  subscribeLanguageSetting,
  type LanguageSetting,
} from '../../i18n/languageSetting';
import { REWIND_CHOICES, getResumeRewind, setResumeRewind } from '../../playback/resumeRewind';
import { TIME_MODES, getTimeMode, setTimeMode, type TimeMode } from '../../playback/timeDisplay';
import {
  useProfileSettings,
  useResetProfileDeviceSetting,
  useServerKnowsSetting,
  useSetProfileSettingAt,
} from './profileSettings';
import { summarizeAppearance } from './subtitleOptions';

interface Choice<V> {
  value: V;
  label: string;
}

/**
 * One setting as a row of pills. Like the tabs, focus and hover only move the highlight; OK or a
 * click selects and saves at once. A selected value that is not a choice marks no pill; focus then
 * starts on the first. The focus stays on the pill that was pressed.
 */
function PillRow<V extends string | number>({
  id,
  title,
  hint,
  choices,
  selected,
  onPick,
  autoFocus = false,
}: {
  id: string;
  title: string;
  hint: string;
  choices: readonly Choice<V>[];
  selected: V;
  onPick(value: V): void;
  /**
   * The screen focuses the first of its rows that asks for it, and a row that appears later
   * (the server's answer came after the screen opened) does not take the focus from it.
   */
  autoFocus?: boolean;
}) {
  const pillKey = (value: V) => `${id}-${value}`;
  const marked = choices.find((choice) => choice.value === selected);
  const start = marked ?? choices[0]!;
  return (
    <>
      <p className="settings-name" id={`${id}-label`}>
        {title}
      </p>
      <p className="settings-hint">{hint}</p>
      <FocusGroup
        focusKey={id}
        enterable
        saveLastFocusedChild={false}
        preferredChildFocusKey={pillKey(start.value)}
        className="settings-choices"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        data-testid={id}
      >
        {choices.map((choice) => (
          <Focusable
            key={choice.value}
            focusKey={pillKey(choice.value)}
            autoFocus={autoFocus && choice === start}
            className={`btn choice settings-pill${choice === marked ? ' selected' : ''}`}
            role="radio"
            aria-checked={choice === marked}
            onClick={() => onPick(choice.value)}
          >
            {choice.label}
          </Focusable>
        ))}
      </FocusGroup>
    </>
  );
}

/**
 * One section of the screen: a heading, a note on what its rows apply to, and the rows. Sections
 * stack top to bottom; the heading and the note are plain text, only the rows take the focus.
 */
function SettingsSection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`${id}-title`} data-testid={id}>
      <h2 id={`${id}-title`} className="settings-section-title">
        {title}
      </h2>
      <p className="settings-note">{note}</p>
      {children}
    </section>
  );
}

const TIME_TEXT: Record<TimeMode, MessageKey> = {
  combined: 'settings.time.combined',
  position: 'settings.time.position',
  remaining: 'settings.time.remaining',
  endsAt: 'settings.time.endsAt',
};

const LANGUAGE_TEXT: Record<LanguageSetting, MessageKey> = {
  auto: 'settings.language.auto',
  de: 'settings.language.de',
  en: 'settings.language.en',
};

const AUTO_PLAY_KEY = 'playback.auto_play_next';

/**
 * The settings screen: the profile's playback section (auto-play next, stored on the server for the
 * profile, as Silo's web app does) and the device section: the app language, what the player's
 * clock shows and how far playback jumps back when it resumes. The device rows are kept on this
 * device only (see `resumeRewind`, `timeDisplay`, `languageSetting`).
 */
export function SettingsScreen({
  onBack,
  onOpenSubtitleAppearance,
}: {
  onBack: () => void;
  onOpenSubtitleAppearance: () => void;
}) {
  const t = useT();
  // The row only exists where the server knows the setting it edits.
  const knowsSubtitles = useServerKnowsSetting('playback.subtitle_appearance');
  const knowsAutoPlay = useServerKnowsSetting(AUTO_PLAY_KEY);
  const { values } = useProfileSettings();
  const setProfile = useSetProfileSettingAt('profile');
  const resetDevice = useResetProfileDeviceSetting();
  const [rewind, setRewind] = useState(getResumeRewind);
  const [timeMode, setMode] = useState(getTimeMode);
  const language = useSyncExternalStore(subscribeLanguageSetting, getLanguageSetting);

  // Saved at the profile, and this TV's own value dropped: it would outrank the profile's and the
  // row would snap back (what the web app does). A failed write leaves the shown value as it was.
  const pickAutoPlay = async (value: 'on' | 'off') => {
    try {
      await setProfile(AUTO_PLAY_KEY, value === 'on');
      await resetDevice(AUTO_PLAY_KEY);
    } catch {
      // The row shows the stored value still.
    }
  };

  return (
    <Screen title={t('settings.title')} onBack={onBack} testId="settings-screen">
      {knowsAutoPlay ? (
        <SettingsSection
          id="settings-playback"
          title={t('settings.playback.title')}
          note={t('settings.playback.note')}
        >
          <PillRow
            id="settings-autoplay"
            title={t('settings.autoPlay.title')}
            hint={t('settings.autoPlay.hint')}
            choices={[
              { value: 'on', label: t('settings.autoPlay.on') },
              { value: 'off', label: t('settings.autoPlay.off') },
            ]}
            selected={values[AUTO_PLAY_KEY] ? 'on' : 'off'}
            autoFocus
            onPick={(value) => void pickAutoPlay(value)}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection
        id="settings-device"
        title={t('settings.device.title')}
        note={t('settings.device.note')}
      >
        <PillRow
          id="settings-language"
          title={t('settings.language.title')}
          hint={t('settings.language.hint')}
          choices={LANGUAGE_CHOICES.map((choice) => ({
            value: choice,
            label: t(LANGUAGE_TEXT[choice]),
          }))}
          selected={language}
          autoFocus
          onPick={setLanguageSetting}
        />
        <PillRow
          id="settings-time"
          title={t('settings.time.title')}
          hint={t('settings.time.hint')}
          choices={TIME_MODES.map((mode) => ({ value: mode, label: t(TIME_TEXT[mode]) }))}
          selected={timeMode}
          onPick={(mode) => {
            setTimeMode(mode);
            setMode(mode);
          }}
        />
        <PillRow
          id="settings-rewind"
          title={t('settings.rewind.title')}
          hint={t('settings.rewind.hint')}
          choices={REWIND_CHOICES.map((seconds) => ({
            value: seconds,
            label:
              seconds === 0 ? t('settings.rewind.off') : t('settings.rewind.seconds', { seconds }),
          }))}
          selected={rewind}
          onPick={(seconds) => {
            setResumeRewind(seconds);
            setRewind(seconds);
          }}
        />
        {knowsSubtitles ? (
          <Button
            focusKey="settings-subtitles"
            className="settings-link"
            data-testid="settings-subtitles"
            onClick={onOpenSubtitleAppearance}
          >
            <span>{t('settings.subtitles.title')}</span>
            <span className="settings-link-value" data-testid="settings-subtitles-summary">
              {summarizeAppearance(values['playback.subtitle_appearance'], t)}
            </span>
          </Button>
        ) : null}
      </SettingsSection>
    </Screen>
  );
}
