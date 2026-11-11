import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { getCurrentFocusKey, setFocus } from '../../app/nav';
import { SUBTITLE_SYNC_MAX_MS } from '../../features/settings/profileSettings';
import { useT, type MessageKey } from '../../i18n';
import type { ReplanResult } from '../session/types';
import { MenuControl, MenuPopover, MenuRow } from './MenuPopover';
import { formatDelay, SUBTITLE_DELAY_STEP_MS } from './subtitleDelay';
import type { InventoryItem, SubtitleRow, SubtitleSource } from './trackMenus';

export const SUBTITLE_OFF_KEY = 'player-menu-subtitle-off';
export const DELAY_MINUS_KEY = 'player-menu-delay-minus';
export const DELAY_PLUS_KEY = 'player-menu-delay-plus';
export const DELAY_RESET_KEY = 'player-menu-delay-reset';
export const subtitleKey = (trackId: string) => `player-menu-subtitle-${trackId}`;

/** The delay row's buttons, left to right. */
const DELAY_KEYS = [DELAY_MINUS_KEY, DELAY_PLUS_KEY, DELAY_RESET_KEY] as const;

const SOURCE_TEXT: Record<SubtitleSource, MessageKey> = {
  embedded: 'player.menu.subtitles.source.embedded',
  external: 'player.menu.subtitles.source.external',
  downloaded: 'player.menu.subtitles.source.downloaded',
};

/**
 * "Off" and the plan's subtitle tracks (language, format and source; the track's own label when it
 * says more), the one that plays checked, then the delay of the subtitle in one row: minus, the
 * value, plus and reset. A pick is a `track_change` replan, handled like an audio pick: applied is
 * saved and closes the menu, refused keeps it open and says so. The delay is a local change of the
 * overlay (the screen saves it), so it never closes the menu. While no subtitle plays the three
 * delay buttons are dimmed and out of the focus order.
 */
export function SubtitlesMenu({
  rows,
  offChecked,
  delayMs,
  pick,
  save,
  onDelay,
  onDelayReset,
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
  /** Back to no delay. */
  onDelayReset(): void;
  /** The pick was applied: the menu closes. */
  onApplied(): void;
  remember(key: string): void;
  recall(): string | null;
  onSide(direction: 'left' | 'right'): void;
}) {
  const t = useT();
  const busy = useRef(false);
  const [refused, setRefused] = useState(false);

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

  const trackKeys = [SUBTITLE_OFF_KEY, ...rows.map((row) => subtitleKey(row.item.track_id))];
  const disabled = {
    [DELAY_MINUS_KEY]: offChecked || delayMs <= -SUBTITLE_SYNC_MAX_MS,
    [DELAY_PLUS_KEY]: offChecked || delayMs >= SUBTITLE_SYNC_MAX_MS,
    [DELAY_RESET_KEY]: offChecked || delayMs === 0,
  };
  const enabledDelayKeys = DELAY_KEYS.filter((key) => !disabled[key]);

  // The delay button that has the focus may be the one that just ran into its limit (plus at the
  // top, reset at 0). The disabled button cannot keep the focus: it goes to the nearest enabled
  // neighbour (the left one when both are as near), else to the row above.
  const dimmed = DELAY_KEYS.map((key) => disabled[key]).join();
  useEffect(() => {
    const focused = DELAY_KEYS.findIndex((key) => key === getCurrentFocusKey());
    if (focused < 0 || !disabled[DELAY_KEYS[focused]!]) return;
    const enabled = DELAY_KEYS.map((key, at) => ({ key, at })).filter(({ key }) => !disabled[key]);
    const nearest = enabled.sort(
      (a, b) => Math.abs(a.at - focused) - Math.abs(b.at - focused) || a.at - b.at,
    )[0];
    void setFocus(nearest ? nearest.key : trackKeys[trackKeys.length - 1]!);
    // Only a change of what is dimmed can take the focus away from a button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimmed]);

  const checked = rows.find((row) => row.checked);
  const fallback = checked ? subtitleKey(checked.item.track_id) : SUBTITLE_OFF_KEY;
  const [firstDelayKey, ...otherDelayKeys] = enabledDelayKeys;
  const focusRows = [
    ...trackKeys,
    ...(firstDelayKey ? [[firstDelayKey, ...otherDelayKeys] as const] : []),
  ];

  const delayButton = (
    key: (typeof DELAY_KEYS)[number],
    props: { label: string; testId: string; onPress(): void; content: ReactNode },
  ) => (
    <MenuControl
      focusKey={key}
      disabled={disabled[key]}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onPress}
    >
      {props.content}
    </MenuControl>
  );

  const step = SUBTITLE_DELAY_STEP_MS;
  return (
    <MenuPopover
      label={t('player.menu.subtitles')}
      testId="subtitles"
      rows={focusRows}
      fallback={fallback}
      remember={remember}
      recall={recall}
      onSide={onSide}
    >
      <section className="player-menu-section" data-testid="menu-subtitles">
        <div role="menu" aria-label={t('player.menu.subtitles')}>
          <MenuRow
            focusKey={SUBTITLE_OFF_KEY}
            className="player-menu-track"
            role="menuitemradio"
            aria-checked={offChecked}
            onClick={() => void choose(null)}
          >
            <span className="player-menu-gutter" aria-hidden="true">
              {offChecked ? <Check size={28} strokeWidth={3} /> : null}
            </span>
            <span className="player-menu-row-name">{t('player.menu.subtitles.off')}</span>
          </MenuRow>
          {rows.map((row) => (
            <MenuRow
              key={row.item.track_id}
              focusKey={subtitleKey(row.item.track_id)}
              className="player-menu-track"
              role="menuitemradio"
              aria-checked={row.checked}
              onClick={() => void choose(row.item)}
            >
              <span className="player-menu-gutter" aria-hidden="true">
                {row.checked ? <Check size={28} strokeWidth={3} /> : null}
              </span>
              <span className="player-menu-track-text">
                <span className="player-menu-line player-menu-line-split">
                  <span className="player-menu-row-name" data-testid="subtitle-language">
                    {row.language}
                  </span>
                  <span className="player-menu-badges">
                    {row.format ? (
                      <span className="player-badge" data-testid="subtitle-format">
                        {row.format}
                      </span>
                    ) : null}
                    <span className="player-badge" data-testid="subtitle-source">
                      {t(SOURCE_TEXT[row.source])}
                    </span>
                  </span>
                </span>
                {row.detail ? (
                  <span className="player-menu-meta" data-testid="subtitle-detail">
                    {row.detail}
                  </span>
                ) : null}
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
        <div role="group" aria-label={t('player.menu.delay')} className="player-delay-row">
          <span className="player-delay-label">{t('player.menu.delay')}</span>
          <span className="player-delay-controls">
            {delayButton(DELAY_MINUS_KEY, {
              label: t('player.menu.delay.earlier', { step }),
              testId: 'delay-minus',
              onPress: () => onDelay(-1),
              content: <Minus size={28} aria-hidden="true" />,
            })}
            <span className="player-delay-value" data-testid="menu-delay-value">
              {formatDelay(delayMs)}
            </span>
            {delayButton(DELAY_PLUS_KEY, {
              label: t('player.menu.delay.later', { step }),
              testId: 'delay-plus',
              onPress: () => onDelay(1),
              content: <Plus size={28} aria-hidden="true" />,
            })}
            {delayButton(DELAY_RESET_KEY, {
              label: t('player.menu.delay.resetLabel'),
              testId: 'delay-reset',
              onPress: onDelayReset,
              content: t('player.menu.delay.reset'),
            })}
          </span>
        </div>
      </section>
    </MenuPopover>
  );
}
