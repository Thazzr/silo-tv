import { useRef, useState } from 'react';
import { useLanguage, useT } from '../../i18n';
import { Check } from 'lucide-react';
import type { ReplanResult } from '../session/types';
import { MenuPopover, MenuRow } from './MenuPopover';
import { formatDelay, SUBTITLE_DELAY_STEP_MS } from './subtitleDelay';
import type { InventoryItem, SubtitleRow } from './trackMenus';

export const SUBTITLE_OFF_KEY = 'player-menu-subtitle-off';
export const DELAY_EARLIER_KEY = 'player-menu-delay-earlier';
export const DELAY_LATER_KEY = 'player-menu-delay-later';
export const subtitleKey = (trackId: string) => `player-menu-subtitle-${trackId}`;

/**
 * "Off" and the plan's subtitle tracks (language, forced and SDH flags), the one that plays
 * checked, then the delay of the subtitle. A pick is a `track_change` replan, handled like an audio
 * pick: applied is saved and closes the menu, refused keeps it open and says so. The delay is
 * a local change of the overlay (the screen saves it), so it never closes the menu.
 */
export function SubtitlesMenu({
  rows,
  offChecked,
  delayMs,
  pick,
  save,
  onDelay,
  onApplied,
  remember,
  recall,
  onSide,
}: {
  rows: readonly SubtitleRow[];
  /** The plan plays no subtitle. */
  offChecked: boolean;
  /** The subtitle delay in ms (positive = later). */
  delayMs: number;
  /** Asks the server for the plan with this subtitle, or none for `null` (the audio is kept). */
  pick(item: InventoryItem | null): Promise<ReplanResult>;
  /** Remembers an applied pick for the series or movie; `null` is "off". */
  save(item: InventoryItem | null): void;
  /** One press of Earlier (-1) or Later (+1). */
  onDelay(direction: -1 | 1): void;
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

  const choose = async (item: InventoryItem | null) => {
    if (busy.current) return;
    busy.current = true;
    setRefused(false);
    try {
      const result = await pick(item);
      if (result.kind === 'applied') {
        save(item);
        onApplied();
      } else setRefused(true);
    } finally {
      busy.current = false;
    }
  };

  const flags = (row: SubtitleRow) =>
    [
      row.forced ? t('player.menu.track.forced') : null,
      row.hearingImpaired ? t('player.menu.track.sdh') : null,
    ].filter(Boolean);

  const keys = [
    SUBTITLE_OFF_KEY,
    ...rows.map((row) => subtitleKey(row.item.track_id)),
    DELAY_EARLIER_KEY,
    DELAY_LATER_KEY,
  ];
  const checked = rows.find((row) => row.checked);
  const fallback = checked ? subtitleKey(checked.item.track_id) : SUBTITLE_OFF_KEY;

  return (
    <MenuPopover
      label={t('player.menu.subtitles')}
      testId="subtitles"
      rows={keys}
      fallback={fallback}
      remember={remember}
      recall={recall}
      onSide={onSide}
    >
      <section className="player-menu-section" data-testid="menu-subtitles">
        <div role="menu" aria-label={t('player.menu.subtitles')}>
          <MenuRow
            focusKey={SUBTITLE_OFF_KEY}
            role="menuitemradio"
            aria-checked={offChecked}
            onClick={() => void choose(null)}
          >
            <span className="player-menu-row-name">{t('player.menu.subtitles.off')}</span>
            <span className="menu-value">
              <span className="player-menu-check">
                {offChecked ? <Check size={32} strokeWidth={3} /> : null}
              </span>
            </span>
          </MenuRow>
          {rows.map((row) => (
            <MenuRow
              key={row.item.track_id}
              focusKey={subtitleKey(row.item.track_id)}
              role="menuitemradio"
              aria-checked={row.checked}
              onClick={() => void choose(row.item)}
            >
              <span className="player-menu-row-name">{row.label}</span>
              <span className="menu-value">
                {flags(row).length > 0 ? (
                  <span data-testid="menu-flags">{flags(row).join(' · ')}</span>
                ) : null}
                <span className="player-menu-check">
                  {row.checked ? <Check size={32} strokeWidth={3} /> : null}
                </span>
              </span>
            </MenuRow>
          ))}
        </div>
        {refused ? (
          <p className="player-menu-note" role="status" data-testid="menu-subtitles-note">
            {t('player.menu.track.unavailable')}
          </p>
        ) : null}
      </section>
      <section className="player-menu-section" data-testid="menu-delay">
        <p className="player-menu-heading">
          {t('player.menu.delay')} ·{' '}
          <span data-testid="menu-delay-value">{formatDelay(delayMs, decimal)}</span>
        </p>
        <div role="group" aria-label={t('player.menu.delay')}>
          <MenuRow focusKey={DELAY_EARLIER_KEY} role="menuitem" onClick={() => onDelay(-1)}>
            <span className="player-menu-row-name">{t('player.menu.delay.earlier')}</span>
            <span className="menu-value">{formatDelay(-SUBTITLE_DELAY_STEP_MS, decimal)}</span>
          </MenuRow>
          <MenuRow focusKey={DELAY_LATER_KEY} role="menuitem" onClick={() => onDelay(1)}>
            <span className="player-menu-row-name">{t('player.menu.delay.later')}</span>
            <span className="menu-value">{formatDelay(SUBTITLE_DELAY_STEP_MS, decimal)}</span>
          </MenuRow>
        </div>
      </section>
    </MenuPopover>
  );
}
