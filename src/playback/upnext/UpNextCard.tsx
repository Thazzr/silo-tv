import { useEffect, useRef } from 'react';
import type { components } from '../../api/generated/schema';
import { useT } from '../../i18n';
import { Artwork, useMediaUrl } from '../../ui/media';
import type { EpisodeRef } from '../episodes/neighbours';
import { episodeLine } from './episodeLine';
import { UP_NEXT_SECONDS, type UpNextChoice } from './useUpNextCard';

interface Props {
  next: EpisodeRef;
  /** The catalog's entry of the next episode, for its still; null until the season list is in. */
  entry: components['schemas']['Episode'] | null;
  /** Spoiler protection covers the still of this unwatched episode. */
  protectStill: boolean;
  seconds: number;
  /** The countdown runs; without it (auto-play off) the card shows a plain heading and no line. */
  counting: boolean;
  /** The controls' focus is on the card. */
  focused: boolean;
  /** The focused button. */
  choice: UpNextChoice;
  /** The overlay is open: the card stands above its controls. */
  raised: boolean;
  onPlay(): void;
  onCancel(): void;
  onFocus(choice: UpNextChoice): void;
}

/**
 * The card at the bottom right while the credits play: "Up next in 10s", the next episode, and
 * Play now / Cancel. The line at its bottom is the countdown (a transform, started when the card
 * appears). Without a countdown it reads "Up next" and has no line.
 */
export function UpNextCard(props: Props) {
  const { next, entry, protectStill, seconds, counting, focused, choice, raised } = props;
  const t = useT();
  const url = useMediaUrl();
  const play = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  // DOM focus follows the controls' focus, without scrolling anything.
  useEffect(() => {
    const target = choice === 'cancel' ? cancel.current : play.current;
    for (const element of [play.current, cancel.current]) {
      if (!element) continue;
      if (focused && element === target) element.focus({ preventScroll: true });
      else if (document.activeElement === element) element.blur();
    }
  }, [focused, choice]);

  return (
    <div
      className="player-upnext"
      role="group"
      aria-label={t('player.upNext.heading')}
      data-raised={raised}
      data-testid="player-upnext"
    >
      <div className="player-upnext-body">
        {entry?.still_url ? (
          <div className="player-upnext-still" data-testid="player-upnext-still">
            <Artwork
              src={url(entry.still_url)}
              thumbhash={entry.still_thumbhash}
              title={next.title}
              protect={protectStill}
            />
          </div>
        ) : null}
        <div className="player-upnext-text">
          <p className="player-upnext-in" aria-live="polite" data-testid="player-upnext-in">
            {counting ? t('player.upNext.in', { seconds }) : t('player.upNext.heading')}
          </p>
          <p className="player-upnext-episode" data-testid="player-upnext-episode">
            {episodeLine(next, t)}
          </p>
        </div>
      </div>
      <div className="player-upnext-actions">
        <button
          ref={play}
          type="button"
          tabIndex={-1}
          className="player-upnext-button"
          data-focused={focused && choice === 'play'}
          data-testid="player-upnext-play"
          onMouseEnter={() => props.onFocus('play')}
          onClick={props.onPlay}
        >
          {t('player.upNext.playNow')}
        </button>
        <button
          ref={cancel}
          type="button"
          tabIndex={-1}
          className="player-upnext-button"
          data-focused={focused && choice === 'cancel'}
          data-testid="player-upnext-cancel"
          onMouseEnter={() => props.onFocus('cancel')}
          onClick={props.onCancel}
        >
          {t('player.upNext.cancel')}
        </button>
      </div>
      {counting ? (
        <span
          className="player-upnext-line"
          aria-hidden="true"
          style={{ animationDuration: `${UP_NEXT_SECONDS}s` }}
        />
      ) : null}
    </div>
  );
}
