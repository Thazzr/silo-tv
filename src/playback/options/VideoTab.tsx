import { useRef, useState } from 'react';
import { Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import {
  useProfileSettings,
  useSetProfileDeviceSetting,
} from '../../features/settings/profileSettings';
import { CheckIcon } from '../osd/icons';
import type { ReplanResult } from '../usePlaybackSession';
import { AUTO, changesQuality, type QualityMenu } from './qualityMenu';

export const QUALITY_KEY_PREFIX = 'player-opt-quality-';
export const AUTO_PLAY_KEY = 'player-opt-autoplay';

/** The focus keys of the tab's rows, top to bottom. */
export function videoRowKeys(menu: QualityMenu | null, episode: boolean): string[] {
  return [
    ...(menu
      ? [AUTO, ...menu.rows.map((row) => row.label)].map((label) => QUALITY_KEY_PREFIX + label)
      : []),
    ...(episode ? [AUTO_PLAY_KEY] : []),
  ];
}

/**
 * Quality (when the plan offers a choice) and, for an episode, "Auto-play next". A quality pick
 * is a replan; a refused one leaves the old stream playing and says so.
 */
export function VideoTab({
  menu,
  preference,
  episode,
  qualityChange,
  onFocusKey,
}: {
  /** Null when the plan offers no choice besides Auto. */
  menu: QualityMenu | null;
  /** The session's quality preference. */
  preference: string;
  episode: boolean;
  qualityChange(label: string): Promise<ReplanResult>;
  /** The row that holds the focus, remembered across a reload of the stream. */
  onFocusKey(key: string): void;
}) {
  const t = useT();
  const settings = useProfileSettings();
  const setSetting = useSetProfileDeviceSetting();
  const busy = useRef(false);
  const [refused, setRefused] = useState(false);
  // The value the viewer just chose, until the write is answered; a failed write drops it.
  const [shown, setShown] = useState<boolean | null>(null);

  const pick = async (target: string) => {
    if (!menu || busy.current || !changesQuality(menu, preference, target)) return;
    busy.current = true;
    setRefused(false);
    try {
      const result = await qualityChange(target);
      // An applied change reloads the stream and this view with it.
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

  const qualityRow = (label: string, name: string) => {
    const checked = menu?.checked === label;
    return (
      <Focusable
        key={label}
        focusKey={QUALITY_KEY_PREFIX + label}
        role="menuitemradio"
        aria-checked={checked}
        className="menu-item menu-item-split player-options-row"
        onFocused={() => onFocusKey(QUALITY_KEY_PREFIX + label)}
        onClick={() => void pick(label)}
      >
        <span className="player-options-row-name">{name}</span>
        <span className="menu-value">{checked ? <CheckIcon /> : null}</span>
      </Focusable>
    );
  };

  return (
    <>
      {menu ? (
        <section className="player-options-section" data-testid="options-quality">
          <p className="lib-panel-heading">
            {menu.unmatched !== null
              ? `${t('player.options.quality')} · ${menu.unmatched}`
              : t('player.options.quality')}
          </p>
          <div role="menu" aria-label={t('player.options.quality')}>
            {qualityRow(AUTO, t('player.options.quality.auto'))}
            {menu.rows.map((row) => qualityRow(row.label, row.name))}
          </div>
          {refused ? (
            <p className="player-options-note" role="status" data-testid="options-quality-note">
              {t('player.options.quality.unavailable')}
            </p>
          ) : null}
        </section>
      ) : null}
      {episode ? (
        <section className="player-options-section">
          <p className="lib-panel-heading">{t('player.options.playback')}</p>
          <Focusable
            focusKey={AUTO_PLAY_KEY}
            role="switch"
            aria-checked={autoPlay}
            className="menu-item menu-item-split player-options-row"
            onFocused={() => onFocusKey(AUTO_PLAY_KEY)}
            onClick={() => void toggleAutoPlay()}
          >
            <span className="player-options-row-name">{t('player.options.autoPlayNext')}</span>
            <span className="menu-value" data-testid="options-autoplay-value">
              {autoPlay ? t('player.options.on') : t('player.options.off')}
            </span>
          </Focusable>
        </section>
      ) : null}
    </>
  );
}
