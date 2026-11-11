import { useRef, useState } from 'react';
import { useLanguage, useT } from '../../i18n';
import { Check } from 'lucide-react';
import type { ReplanResult } from '../session/types';
import { MenuPopover, MenuRow } from './MenuPopover';
import { AUTO, changesQuality, formatBitrate, type QualityMenu } from './qualityMenu';

export const QUALITY_KEY_PREFIX = 'player-menu-quality-';

/**
 * The gear's menu: the quality, as Silo's web player lists it. A pick is a replan. One that is
 * applied closes the menu (the stream reloads under it and the focus goes back to the gear); a
 * refused one leaves the old stream playing, the menu open, and says so.
 */
export function SettingsMenu({
  menu,
  preference,
  qualityChange,
  onApplied,
  remember,
  recall,
  onSide,
}: {
  menu: QualityMenu;
  /** The session's quality preference. */
  preference: string;
  qualityChange(label: string): Promise<ReplanResult>;
  /** The pick was applied: the menu closes. */
  onApplied(): void;
  remember(key: string): void;
  recall(): string | null;
  onSide(direction: 'left' | 'right'): void;
}) {
  const t = useT();
  const language = useLanguage();
  const busy = useRef(false);
  const [refused, setRefused] = useState(false);
  const decimal = language === 'de' ? ',' : '.';

  const pick = async (target: string) => {
    if (busy.current || !changesQuality(menu, preference, target)) return;
    busy.current = true;
    setRefused(false);
    try {
      const result = await qualityChange(target);
      if (result.kind === 'applied') onApplied();
      else setRefused(true);
    } finally {
      busy.current = false;
    }
  };

  const qualityRow = (label: string, name: string, bitrateKbps?: number) => {
    const checked = menu.checked === label;
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
          <span className="player-menu-disc">
            {checked ? (
              <span className="player-menu-disc-on" aria-hidden="true" data-testid="menu-selected">
                <Check size={20} strokeWidth={3} />
              </span>
            ) : null}
          </span>
        </span>
      </MenuRow>
    );
  };

  const rows = [AUTO, ...menu.rows.map((row) => row.label)].map(
    (label) => QUALITY_KEY_PREFIX + label,
  );
  const fallback = menu.checked ? QUALITY_KEY_PREFIX + menu.checked : rows[0]!;

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
    </MenuPopover>
  );
}
