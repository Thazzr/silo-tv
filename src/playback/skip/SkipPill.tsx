import { useEffect, useRef } from 'react';
import { useT, type MessageKey } from '../../i18n';
import type { SkipPill as Pill } from './useSkipPill';

const TEXT: Record<Pill['kind'], MessageKey> = {
  intro: 'player.skip.intro',
  recap: 'player.skip.recap',
  credits: 'player.skip.credits',
  preview: 'player.skip.preview',
};

interface Props {
  pill: Pill;
  /** The pill holds the focus (the controls decide). */
  focused: boolean;
  /** The 5 s window is running: the fill animation plays. */
  filling: boolean;
  /** The overlay is open: the pill stands above its controls. */
  raised: boolean;
  onActivate(): void;
  onFocus(): void;
}

/** The round-cornered "Skip intro" button at the bottom right of the picture. */
export function SkipPillButton({ pill, focused, filling, raised, onActivate, onFocus }: Props) {
  const t = useT();
  const button = useRef<HTMLButtonElement>(null);

  // DOM focus follows the controls' focus, without scrolling anything.
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    if (focused) element.focus({ preventScroll: true });
    else if (document.activeElement === element) element.blur();
  }, [focused]);

  return (
    <button
      ref={button}
      type="button"
      tabIndex={-1}
      className="player-skip"
      data-focus-key="pill"
      data-focused={focused}
      data-raised={raised}
      data-testid="player-skip"
      onMouseMove={onFocus}
      onClick={onActivate}
    >
      {filling ? <span className="player-skip-fill" data-testid="player-skip-fill" /> : null}
      <span className="player-skip-text">
        {pill.mode === 'watch' ? t('player.skip.watchIntro') : t(TEXT[pill.kind])}
      </span>
    </button>
  );
}
