import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { PROMPT_MS } from '../session/bufferingQuality';
import type { BufferingOffer } from '../session/BufferingManager';
import type { BufferingChoice } from './useBufferingPill';

interface Props {
  offer: BufferingOffer;
  /** The controls' focus is on the pill. */
  focused: boolean;
  /** The prompt's focused button. */
  choice: BufferingChoice;
  /** The overlay is open: the pill stands above its controls. */
  raised: boolean;
  /** The countdown line plays (it is paused while playback is). */
  running: boolean;
  elapsedMs: number;
  onLower(): void;
  onKeep(): void;
  onRestore(): void;
  onFocus(choice: BufferingChoice): void;
}

/**
 * The buffering prompt ("Playback keeps buffering": Lower quality / Keep quality) or the undo pill
 * of a lowering ("Restore quality"), in the corner the skip pill uses.
 */
export function BufferingPill(props: Props) {
  const { offer, focused, choice, raised, running, elapsedMs } = props;
  const t = useT();
  const lower = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const undo = offer.kind === 'undo';

  // DOM focus follows the controls' focus, without scrolling anything.
  useEffect(() => {
    const target = undo ? restore.current : choice === 'keep' ? keep.current : lower.current;
    for (const element of [lower.current, keep.current, restore.current]) {
      if (!element) continue;
      if (focused && element === target) element.focus({ preventScroll: true });
      else if (document.activeElement === element) element.blur();
    }
  }, [focused, choice, undo]);

  return (
    <div
      className="player-buffering"
      role="group"
      aria-label={t(undo ? 'player.buffering.lowered' : 'player.buffering.title')}
      data-kind={offer.kind}
      data-raised={raised}
      data-testid="player-buffering"
    >
      <p className="player-buffering-title">
        {t(undo ? 'player.buffering.lowered' : 'player.buffering.title')}
      </p>
      <div className="player-buffering-actions">
        {undo ? (
          <button
            ref={restore}
            type="button"
            tabIndex={-1}
            className="player-buffering-button"
            data-focused={focused}
            data-testid="player-buffering-restore"
            onMouseMove={() => props.onFocus('lower')}
            onClick={props.onRestore}
          >
            {t('player.buffering.restore')}
          </button>
        ) : (
          <>
            <button
              ref={lower}
              type="button"
              tabIndex={-1}
              className="player-buffering-button"
              data-focused={focused && choice === 'lower'}
              data-testid="player-buffering-lower"
              onMouseMove={() => props.onFocus('lower')}
              onClick={props.onLower}
            >
              {t('player.buffering.lower')}
            </button>
            <button
              ref={keep}
              type="button"
              tabIndex={-1}
              className="player-buffering-button"
              data-focused={focused && choice === 'keep'}
              data-testid="player-buffering-keep"
              onMouseMove={() => props.onFocus('keep')}
              onClick={props.onKeep}
            >
              {t('player.buffering.keep')}
            </button>
          </>
        )}
      </div>
      {/* The countdown: a thin line that shrinks over the pill's 15 s (transform only). */}
      <span
        className="player-buffering-line"
        data-testid="player-buffering-line"
        data-running={running}
        style={{
          animationDuration: `${PROMPT_MS}ms`,
          animationDelay: `-${elapsedMs}ms`,
        }}
      />
    </div>
  );
}
