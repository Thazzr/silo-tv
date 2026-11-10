import { useRef, useState } from 'react';
import { useLanguage, useT } from '../../i18n';
import {
  useProfileSettings,
  useSetProfileDeviceSetting,
} from '../../features/settings/profileSettings';
import { CheckIcon } from '../osd/icons';
import type { ReplanResult } from '../usePlaybackSession';
import { MenuPopover, MenuRow } from './MenuPopover';
import { AUTO, changesQuality, formatBitrate, type QualityMenu } from './qualityMenu';

export const QUALITY_KEY_PREFIX = 'player-menu-quality-';
export const AUTO_PLAY_KEY = 'player-menu-autoplay';

/** The focus keys of the menu's rows, top to bottom. */
export function settingsRowKeys(menu: QualityMenu | null, episode: boolean): string[] {
  return [
    ...(menu
      ? [AUTO, ...menu.rows.map((row) => row.label)].map((label) => QUALITY_KEY_PREFIX + label)
      : []),
    ...(episode ? [AUTO_PLAY_KEY] : []),
  ];
}

/**
 * The gear's menu: Quality (when the plan offers a choice) and, for an episode, "Auto-play next".
 * A quality pick is a replan; a refused one leaves the old stream playing and says so.
 */
export function SettingsMenu({
  menu,
  preference,
  episode,
  qualityChange,
  remember,
  recall,
  onSide,
}: {
  /** Null when the plan offers no choice besides Auto. */
  menu: QualityMenu | null;
  /** The session's quality preference. */
  preference: string;
  episode: boolean;
  qualityChange(label: string): Promise<ReplanResult>;
  remember(key: string): void;
  recall(): string | null;
  onSide(direction: 'left' | 'right'): void;
}) {
  const t = useT();
  const language = useLanguage();
  const settings = useProfileSettings();
  const setSetting = useSetProfileDeviceSetting();
  const busy = useRef(false);
  const [refused, setRefused] = useState(false);
  // The value the viewer just chose, until the write is answered; a failed write drops it.
  const [shown, setShown] = useState<boolean | null>(null);
  const decimal = language === 'de' ? ',' : '.';

  const pick = async (target: string) => {
    if (!menu || busy.current || !changesQuality(menu, preference, target)) return;
    busy.current = true;
    setRefused(false);
    try {
      const result = await qualityChange(target);
      // An applied change reloads the stream and this menu with it.
      if (result.kind !== 'applied') setRefused(true);
    } finally {
      busy.current = false;
    }
  };

  const autoPlay = shown ?? settings.values['playback.auto_play_next'];
  const toggleAutoPlay = async () => {
    if (shown !== null) return;
    setShown(!autoPlay);
    try {
      await setSetting('playback.auto_play_next', !autoPlay);
    } catch {
      // The row shows the stored value again below.
    } finally {
      setShown(null);
    }
  };

  const qualityRow = (label: string, name: string, bitrateKbps?: number) => {
    const checked = menu?.checked === label;
    const bitrate = formatBitrate(bitrateKbps, decimal);
    return (
      <MenuRow
        key={label}
        focusKey={QUALITY_KEY_PREFIX + label}
        role="menuitemradio"
        aria-checked={checked}
        onClick={() => void pick(label)}
      >
        <span className="player-menu-row-name">{name}</span>
        <span className="menu-value">
          {bitrate ? <span data-testid="menu-bitrate">{bitrate}</span> : null}
          <span className="player-menu-check">{checked ? <CheckIcon /> : null}</span>
        </span>
      </MenuRow>
    );
  };

  const rows = settingsRowKeys(menu, episode);
  const fallback = menu?.checked ? QUALITY_KEY_PREFIX + menu.checked : rows[0]!;

  return (
    <MenuPopover
      label={t('player.menu.settings')}
      testId="settings"
      rows={rows}
      fallback={fallback}
      remember={remember}
      recall={recall}
      onSide={onSide}
    >
      {menu ? (
        <section className="player-menu-section" data-testid="menu-quality">
          <p className="player-menu-heading">
            {menu.unmatched !== null
              ? `${t('player.menu.quality')} · ${menu.unmatched}`
              : t('player.menu.quality')}
          </p>
          <div role="menu" aria-label={t('player.menu.quality')}>
            {qualityRow(AUTO, t('player.menu.quality.auto'))}
            {menu.rows.map((row) => qualityRow(row.label, row.name, row.bitrateKbps))}
          </div>
          {refused ? (
            <p className="player-menu-note" role="status" data-testid="menu-quality-note">
              {t('player.menu.quality.unavailable')}
            </p>
          ) : null}
        </section>
      ) : null}
      {episode ? (
        <section className="player-menu-section">
          <p className="player-menu-heading">{t('player.menu.playback')}</p>
          <MenuRow
            focusKey={AUTO_PLAY_KEY}
            role="switch"
            aria-checked={autoPlay}
            onClick={() => void toggleAutoPlay()}
          >
            <span className="player-menu-row-name">{t('player.menu.autoPlayNext')}</span>
            <span className="menu-value" data-testid="menu-autoplay-value">
              {autoPlay ? t('player.menu.on') : t('player.menu.off')}
            </span>
          </MenuRow>
        </section>
      ) : null}
    </MenuPopover>
  );
}
