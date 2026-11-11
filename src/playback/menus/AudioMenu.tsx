import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Check } from 'lucide-react';
import type { ReplanResult, S } from '../session/types';
import { MenuPopover, MenuRow } from './MenuPopover';
import type { AudioRow } from './trackMenus';

export const audioKey = (index: number) => `player-menu-audio-${index}`;

/**
 * The audio tracks of the version that plays; the one the plan plays is checked. A pick is a
 * `track_change` replan. One that is applied is saved for the series or movie, then closes the menu
 * (the stream may reload under it and the focus goes back to the button); a refused one leaves the
 * old track playing, the menu open, and says so.
 */
export function AudioMenu({
  rows,
  pick,
  save,
  onApplied,
  remember,
  recall,
  onSide,
}: {
  rows: readonly AudioRow[];
  /** Asks the server for the plan with this track (the subtitle the plan plays is kept). */
  pick(index: number): Promise<ReplanResult>;
  /** Remembers an applied pick for the series or movie. */
  save(index: number, track: S['WatchAudioTrack']): void;
  /** The pick was applied: the menu closes. */
  onApplied(): void;
  remember(key: string): void;
  recall(): string | null;
  onSide(direction: 'left' | 'right'): void;
}) {
  const t = useT();
  const busy = useRef(false);
  const [refused, setRefused] = useState(false);

  const choose = async (row: AudioRow) => {
    if (busy.current || row.checked) return;
    busy.current = true;
    setRefused(false);
    try {
      const result = await pick(row.index);
      if (result.kind === 'applied') {
        // Only a pick that took effect is worth remembering.
        save(row.index, row.track);
        onApplied();
      } else setRefused(true);
    } finally {
      busy.current = false;
    }
  };

  // The menu is only offered with a choice, so there is a first row.
  const checked = rows.find((row) => row.checked) ?? rows[0]!;
  return (
    <MenuPopover
      label={t('player.menu.audio')}
      testId="audio"
      rows={rows.map((row) => audioKey(row.index))}
      fallback={audioKey(checked.index)}
      remember={remember}
      recall={recall}
      onSide={onSide}
    >
      <p className="player-menu-heading">{t('player.menu.audio.heading')}</p>
      <div role="menu" aria-label={t('player.menu.audio')} data-testid="menu-audio">
        {rows.map((row) => (
          <MenuRow
            key={row.index}
            focusKey={audioKey(row.index)}
            className="player-menu-track"
            role="menuitemradio"
            aria-checked={row.checked}
            data-checked={row.checked}
            onClick={() => void choose(row)}
          >
            <span className="player-menu-gutter" aria-hidden="true">
              {row.checked ? <Check size={28} strokeWidth={3} /> : null}
            </span>
            <span className="player-menu-track-text">
              <span className="player-menu-line">
                <span className="player-menu-row-name" data-testid="audio-title">
                  {row.title}
                </span>
                {row.codec ? (
                  <span className="player-badge" data-testid="audio-codec">
                    {row.codec}
                  </span>
                ) : null}
                {row.channels ? (
                  <span className="player-badge" data-testid="audio-channels">
                    {row.channels}
                  </span>
                ) : null}
                {row.isDefault ? (
                  <span className="player-badge player-badge-outline" data-testid="audio-default">
                    {t('player.menu.audio.default')}
                  </span>
                ) : null}
              </span>
              {row.meta ? (
                <span className="player-menu-meta" data-testid="audio-meta">
                  {row.meta}
                </span>
              ) : null}
            </span>
          </MenuRow>
        ))}
      </div>
      {refused ? (
        <p className="player-menu-note" role="status" data-testid="menu-audio-note">
          {t('player.menu.track.unavailable')}
        </p>
      ) : null}
    </MenuPopover>
  );
}
