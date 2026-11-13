import { useCallback, useEffect } from 'react';
import { Play, X } from 'lucide-react';
import {
  FocusGroup,
  Focusable,
  SelfFocusing,
  setFocus,
  stackArrows,
  useBackHandler,
} from '../../app/nav';
import { useLanguage, useT } from '../../i18n';
import { getPlatform } from '../../platform';
import {
  Artwork,
  CardPrefsProvider,
  LandscapeCard,
  Row,
  RowSkeleton,
  protectsEpisodeOverview,
  protectsEpisodeStill,
  rowFocusKey,
  useArtUrl,
  useMediaUrl,
  type CatalogItem,
  type CardContext,
} from '../../ui/media';
import { episodeMetaLine } from '../../features/detail/info';
import { useAutoPlayNext } from '../../features/settings/autoPlayNext';
import { useProfileSettings } from '../../features/settings/profileSettings';
import type { EpisodeNeighbours } from '../episodes/useEpisodeNeighbours';
import { episodeLine } from './episodeLine';
import { isStillWatchingGated } from './stillWatching';
import { useCountdown } from './useCountdown';
import { UP_NEXT_SECONDS } from './useUpNextCard';
import { useOnDeck } from './useOnDeck';

export const END_CLOSE_KEY = 'player-end-close';
export const END_PLAY_KEY = 'player-end-play';
export const END_AUTOPLAY_KEY = 'player-end-autoplay';
export const END_BACK_KEY = 'player-end-back';
const ON_DECK_ROW = 'player-end-ondeck';
/** The row's left inset: the safe area, so its first card lines up with the text above it. */
const ROW_INSET = 96;

const contentId = (item: CatalogItem) => item.content_id;

const RING_RADIUS = 28;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface Props {
  /** The series the episode belongs to; its own entries stay out of the On Deck row. */
  seriesId: string | undefined;
  seriesTitle: string | undefined;
  neighbours: EpisodeNeighbours;
  /** The stream has played to its end; before that the screen waits for the credits. */
  ended: boolean;
  /** Plays the next episode: `automatic` from the countdown, else the viewer's start. */
  onPlayNext(automatic: boolean): void;
  /** OK on a card of the On Deck row: resumes that item. */
  onPlayItem(item: CatalogItem): void;
  /** The X and Back: stops playback and leaves the player. */
  onClose(): void;
}

/**
 * The post-roll screen, like the web's "Up next" page: over the playing picture from 30 s before the
 * end, with the next episode, Play now with its countdown, the auto-play switch and the On Deck
 * row. The countdown runs only after the stream has ended, and only with auto-play on and the
 * still-watching gate open; moving the focus does not stop it.
 */
export function EndScreen(props: Props) {
  const { seriesId, seriesTitle, neighbours, ended, onPlayNext, onPlayItem, onClose } = props;
  const t = useT();
  const lang = useLanguage();
  const url = useMediaUrl();
  const autoPlay = useAutoPlayNext();
  const { values } = useProfileSettings();
  const onDeck = useOnDeck(seriesId);
  const { next, nextEntry, settled } = neighbours;

  useBackHandler(onClose);

  // Past the still-watching limit the screen stays up without a countdown.
  const armed = autoPlay.enabled && !isStillWatchingGated();
  const counting = ended && armed && next !== null;
  const seconds = useCountdown(counting, UP_NEXT_SECONDS, () => onPlayNext(true));

  // The remote's own keys: Play plays the next episode, Stop leaves. OK and the arrows belong to
  // the focused control and the navigation.
  const playNext = useCallback(() => onPlayNext(false), [onPlayNext]);
  const hasNext = next !== null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = getPlatform().mapKey(e);
      if (key === 'play' && hasNext) {
        e.preventDefault();
        playNext();
      } else if (key === 'stop') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasNext, playNext, onClose]);

  // The primary control takes the focus once it exists (the season list may still be loading).
  // One task later: the navigation handles a key press asynchronously, and a press that was
  // under way as the screen opened must not land on it.
  const primary = !settled ? null : hasNext ? END_PLAY_KEY : END_BACK_KEY;
  useEffect(() => {
    if (primary === null) return undefined;
    const timer = setTimeout(() => void setFocus(primary), 0);
    return () => clearTimeout(timer);
  }, [primary]);

  const stops = [
    END_CLOSE_KEY,
    ...(primary === null ? [] : [primary]),
    ...(hasNext && autoPlay.known ? [END_AUTOPLAY_KEY] : []),
    ...(onDeck.items.length > 0 ? [rowFocusKey(ON_DECK_ROW)] : []),
  ];

  const spoilers = {
    images: values['catalog.hide_unwatched_episode_images'],
    overviews: values['catalog.hide_unwatched_episode_overviews'],
  };
  const heading =
    settled && !hasNext ? t('player.upNext.headingFinished') : t('player.upNext.heading');
  const meta = nextEntry ? episodeMetaLine(nextEntry, lang, t) : '';

  return (
    <SelfFocusing>
      <div className="player-end" role="dialog" aria-label={heading} data-testid="player-end">
        <FocusGroup
          focusKey="player-end"
          boundary
          className="player-end-body"
          onArrow={stackArrows(stops)}
        >
          <div className="player-end-top">
            <p className="player-end-heading">{heading}</p>
            <Focusable
              focusKey={END_CLOSE_KEY}
              className="player-end-close"
              aria-label={t('player.upNext.close')}
              data-testid="player-end-close"
              onClick={onClose}
            >
              <X size={36} aria-hidden="true" />
            </Focusable>
          </div>
          {!settled ? (
            <div className="player-end-next" role="status" data-testid="player-end-loading">
              <div className="player-end-still" aria-hidden="true" />
              <div className="player-end-info" aria-hidden="true">
                <div className="player-end-ghost" />
                <div className="player-end-ghost" />
                <div className="player-end-ghost" />
              </div>
            </div>
          ) : next ? (
            <>
              <div className="player-end-next">
                <div className="player-end-still" data-testid="player-end-still">
                  {nextEntry?.still_url ? (
                    <Artwork
                      src={url(nextEntry.still_url)}
                      thumbhash={nextEntry.still_thumbhash}
                      title={next.title}
                      protect={protectsEpisodeStill(nextEntry, spoilers)}
                    />
                  ) : (
                    <span className="player-end-nostill">{t('player.upNext.noPreview')}</span>
                  )}
                </div>
                <div className="player-end-info">
                  {seriesTitle ? (
                    <p className="player-end-series" data-testid="player-end-series">
                      {seriesTitle}
                    </p>
                  ) : null}
                  <p className="player-end-episode" data-testid="player-end-episode">
                    {episodeLine(next, t)}
                  </p>
                  {meta !== '' ? (
                    <p className="player-end-meta" data-testid="player-end-meta">
                      {meta}
                    </p>
                  ) : null}
                  {nextEntry?.overview && !protectsEpisodeOverview(nextEntry, spoilers) ? (
                    <p className="player-end-overview" data-testid="player-end-overview">
                      {nextEntry.overview}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="player-end-actions">
                <Focusable
                  focusKey={END_PLAY_KEY}
                  className="player-end-play"
                  data-testid="player-end-play"
                  onClick={playNext}
                >
                  <Play size={36} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  {t('player.upNext.playNow')}
                </Focusable>
                {armed ? (
                  <div className="player-end-countdown" data-testid="player-end-countdown">
                    {ended ? (
                      <>
                        <svg
                          width="64"
                          height="64"
                          viewBox="0 0 64 64"
                          className="player-end-ring"
                          aria-hidden="true"
                        >
                          <circle
                            cx="32"
                            cy="32"
                            r={RING_RADIUS}
                            className="player-end-ring-track"
                          />
                          <circle
                            cx="32"
                            cy="32"
                            r={RING_RADIUS}
                            className="player-end-ring-fill"
                            data-testid="player-end-ring"
                            strokeDasharray={RING_LENGTH}
                            strokeDashoffset={RING_LENGTH * (1 - seconds / UP_NEXT_SECONDS)}
                          />
                        </svg>
                        <span data-testid="player-end-startsin">
                          {t('player.upNext.startsIn', { seconds })}
                        </span>
                      </>
                    ) : (
                      <span data-testid="player-end-waits">
                        {t('player.upNext.startsAfterCredits')}
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
              {autoPlay.known ? (
                <Focusable
                  focusKey={END_AUTOPLAY_KEY}
                  className="player-end-switch"
                  role="switch"
                  aria-checked={autoPlay.enabled}
                  data-testid="player-end-autoplay"
                  onClick={() => void autoPlay.set(!autoPlay.enabled)}
                >
                  {t('player.upNext.autoplay')}
                  <span className="player-end-switch-track" aria-hidden="true">
                    <span className="player-end-switch-knob" />
                  </span>
                </Focusable>
              ) : null}
            </>
          ) : (
            <div className="player-end-finished" data-testid="player-end-finished">
              <p className="player-end-series">
                {seriesTitle
                  ? t('player.upNext.finishedSeries', { series: seriesTitle })
                  : t('player.upNext.endOfPlayback')}
              </p>
              <p className="player-end-meta">{t('player.upNext.noMoreEpisodes')}</p>
              <Focusable
                focusKey={END_BACK_KEY}
                className="player-end-play"
                data-testid="player-end-back"
                onClick={onClose}
              >
                {t('player.back')}
              </Focusable>
            </div>
          )}
          {onDeck.items.length > 0 ? (
            <CardPrefsProvider>
              <OnDeckRow items={onDeck.items} onPlayItem={onPlayItem} />
            </CardPrefsProvider>
          ) : onDeck.pending ? (
            <div className="player-end-row">
              <RowSkeleton shape="landscape" />
            </div>
          ) : null}
        </FocusGroup>
      </div>
    </SelfFocusing>
  );
}

/** The wide cards of what is in progress; they read the card preferences, so this sits under their provider. */
function OnDeckRow({
  items,
  onPlayItem,
}: {
  items: readonly CatalogItem[];
  onPlayItem(item: CatalogItem): void;
}) {
  const t = useT();
  const artUrl = useArtUrl('landscape');
  const renderCard = useCallback(
    (item: CatalogItem, ctx: CardContext) => (
      <LandscapeCard
        item={item}
        focusKey={ctx.focusKey}
        onFocused={ctx.onFocused}
        onOpen={onPlayItem}
        onPlay={onPlayItem}
      />
    ),
    [onPlayItem],
  );
  return (
    <div className="player-end-row" data-testid="player-end-ondeck">
      <Row
        rowId={ON_DECK_ROW}
        title={t('player.upNext.onDeck')}
        shape="landscape"
        items={items}
        getKey={contentId}
        renderCard={renderCard}
        artUrl={artUrl}
        inset={ROW_INSET}
      />
    </div>
  );
}
