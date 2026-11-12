import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  EllipsisVertical,
  Eye,
  Heart,
  Play,
  Plus,
  RotateCcw,
  ThumbsDown,
} from 'lucide-react';
import { FocusGroup, moveFocusTo, useBackHandler, type ArrowHandler } from '../../app/nav';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { formatClock } from '../../playback/format';
import type { StartIntent } from '../../playback/resume';
import { playedShare, primaryAction, watchedState } from './actions';
import { ChoiceDialog, type Choice } from './ChoiceDialog';
import type { DetailKind, ItemDetail } from './info';
import { useSetRating, useSetUserFlag, useSetWatched, type UserFlag } from './itemActions';
import { PillDialog } from './PillDialogs';
import { PillsRow, type PillKind } from './PillsRow';
import { MAX_STARS, RATING_KEY, StarRating } from './StarRating';
import type { Pills } from './usePicks';

export const PLAY_KEY = 'detail-play';
export const TRANSLATE_KEY = 'detail-translate';
const WATCHED_KEY = 'detail-watched';
const FAVORITE_KEY = 'detail-favorite';
const MENU_KEY = 'detail-menu';

/**
 * The action row of a detail page, like Silo's web app: the primary button (Play, Resume, ...), the
 * watched toggle, the favourite heart, the star rating and the More menu, then the translate pill
 * when the page offers it. A season or episode page has no heart, stars or watchlist, and its More
 * menu shows only when it holds something. Left and Right walk the row (the stars take them while a rating is
 * being picked); the dialogs the buttons open hold the focus until they close.
 *
 * A movie or episode page also gets the pills row (`pills`) under it, a row of its own with its own
 * focus order; the lists its pills open share this row's dialog host.
 */
export function ActionRow({
  detail,
  kind,
  playable,
  resumeSeconds,
  totalSeconds,
  stateKnown,
  onPlay,
  onFocused,
  onPillsFocused,
  onNotice,
  onTranslate,
  pills,
}: {
  detail: ItemDetail;
  kind: DetailKind;
  /** Whether something plays: the movie itself, a series' target episode, a season's first one. */
  playable: boolean;
  /** The resume point of what plays, or null when it plays from the start. */
  resumeSeconds: number | null;
  /** The length of what plays, for the progress share (0 when unknown). */
  totalSeconds: number;
  /** Whether the watch state of what plays is known; before that the player asks itself. */
  stateKnown: boolean;
  onPlay: (intent: StartIntent) => void;
  onFocused: () => void;
  /** The focus moved onto the pills row (the page may need to scroll to show it). */
  onPillsFocused: () => void;
  /** Shows a short confirmation or failure line on the page. */
  onNotice: (message: string) => void;
  /** Set when the translate pill shows; OK on it calls this. */
  onTranslate?: () => void;
  /** The version, audio and subtitle pills of a movie or episode page. */
  pills?: Pills;
}) {
  const t = useT();
  const [dialog, setDialog] = useState<'resume' | 'menu' | PillKind | null>(null);
  const closeDialog = () => setDialog(null);
  const resumeAt = resumeSeconds ?? 0;
  // The star being picked (1 to 5), or null while no rating is being picked.
  const [picking, setPicking] = useState<number | null>(null);

  const action = primaryAction({ detail, kind, playable, resumeSeconds, totalSeconds });
  const watched = watchedState(detail, kind);
  // Only a movie and a series are in the viewer's lists; a season and an episode are not.
  const inLists = kind === 'item' || kind === 'series';
  const setWatched = useSetWatched();
  const setFlag = useSetUserFlag(detail.content_id);
  const setRating = useSetRating(detail.content_id);
  const favorite = detail.user_state?.is_favorite ?? false;
  const inWatchlist = detail.user_state?.in_watchlist ?? false;
  const notInterested = detail.user_state?.not_interested ?? false;
  const rating = detail.user_rating ?? null;

  const markWatched = (played: boolean) =>
    setWatched.mutate(
      { id: detail.content_id, played },
      { onSuccess: () => onNotice(t(played ? 'detail.markedWatched' : 'detail.markedUnwatched')) },
    );
  const flag = (which: UserFlag, on: boolean, done: string | null, failed: string | null) =>
    setFlag.mutate(
      { flag: which, on },
      {
        onSuccess: () => {
          if (done) onNotice(done);
        },
        onError: () => {
          if (failed) onNotice(failed);
        },
      },
    );
  const toggleWatchlist = () =>
    flag(
      'in_watchlist',
      !inWatchlist,
      t(inWatchlist ? 'detail.watchlistRemoved' : 'detail.watchlistAdded'),
      t('detail.watchlistFailed'),
    );
  const toggleNotInterested = () => flag('not_interested', !notInterested, null, null);
  const commitRating = (stars: number) => {
    setPicking(null);
    // The star that is already set clears the rating, like on the web.
    setRating.mutate(stars === rating ? null : stars, {
      onError: () => onNotice(t('detail.ratingFailed')),
    });
  };

  // Back puts the rating back to what it was.
  useBackHandler(picking !== null ? () => setPicking(null) : undefined);

  const play = (intent: StartIntent) => {
    closeDialog();
    onPlay(intent);
  };
  const primaryDisabled = action.mode === 'none';
  const press = () => {
    if (action.mode === 'ask') setDialog('resume');
    else if (action.mode === 'resume') onPlay({ kind: 'resume' });
    else onPlay({ kind: stateKnown ? 'beginning' : 'ask' });
  };

  const menu: Choice[] = [];
  if (action.startOverInMenu) {
    menu.push({
      key: 'detail-menu-start-over',
      label: t('detail.playFromBeginning'),
      icon: <RotateCcw size={28} aria-hidden="true" />,
      onSelect: () => play({ kind: 'beginning' }),
    });
  }
  if (watched.hasProgress) {
    menu.push({
      key: 'detail-menu-unwatched',
      label: t(watched.unwatchLabel),
      icon: <Eye size={28} aria-hidden="true" />,
      onSelect: () => {
        closeDialog();
        markWatched(false);
      },
    });
  }
  if (inLists) {
    menu.push({
      key: 'detail-menu-watchlist',
      label: t(inWatchlist ? 'detail.removeFromWatchlist' : 'detail.addToWatchlist'),
      icon: inWatchlist ? (
        <Check size={28} aria-hidden="true" />
      ) : (
        <Plus size={28} aria-hidden="true" />
      ),
      onSelect: () => {
        closeDialog();
        toggleWatchlist();
      },
    });
  }
  if (inLists && detail.user_state) {
    menu.push({
      key: 'detail-menu-not-interested',
      label: t(notInterested ? 'detail.showInRecommendations' : 'detail.notInterested'),
      icon: <ThumbsDown size={28} aria-hidden="true" />,
      onSelect: () => {
        closeDialog();
        toggleNotInterested();
      },
    });
  }

  // Which buttons the row mounts. The focus order below and the buttons rendered further down
  // both read these, so the order never names a button that is not there.
  const hasHeartAndStars = inLists;
  const hasMenu = menu.length > 0;
  const hasTranslate = onTranslate !== undefined;
  // The focus order of the row, left to right: what Left and Right walk.
  const keys = [
    ...(primaryDisabled ? [] : [PLAY_KEY]),
    WATCHED_KEY,
    ...(hasHeartAndStars ? [FAVORITE_KEY, RATING_KEY] : []),
    ...(hasMenu ? [MENU_KEY] : []),
    ...(hasTranslate ? [TRANSLATE_KEY] : []),
  ];
  const onArrow: ArrowHandler = (direction, fromKey) => {
    if (picking !== null) {
      if (direction === 'left') setPicking(Math.max(1, picking - 1));
      else if (direction === 'right') setPicking(Math.min(MAX_STARS, picking + 1));
      else {
        // Up and Down leave the stars: picking ends and the press goes on.
        setPicking(null);
        return false;
      }
      return true;
    }
    if (direction !== 'left' && direction !== 'right') return false;
    const next = keys[keys.indexOf(fromKey) + (direction === 'right' ? 1 : -1)];
    // The ends hold the focus: there is nothing to the left of the first or right of the last.
    return next === undefined ? true : moveFocusTo(next);
  };

  return (
    <>
      <FocusGroup
        focusKey="detail-actions"
        enterable
        saveLastFocusedChild={false}
        onArrow={onArrow}
        className="detail-row detail-actions"
        role="group"
        data-testid="detail-actions"
      >
        <Button
          focusKey={PLAY_KEY}
          className="detail-pill detail-play"
          autoFocus
          disabled={primaryDisabled}
          onFocused={onFocused}
          onClick={press}
          data-testid="detail-primary"
        >
          {action.fill !== null ? (
            <span
              className="detail-play-fill"
              data-testid="detail-play-fill"
              style={{ transform: `scaleX(${action.fill})` }}
              aria-hidden="true"
            />
          ) : null}
          <Play size={28} fill="currentColor" aria-hidden="true" />
          <span className="detail-play-label">{t(action.label)}</span>
        </Button>
        <Button
          focusKey={WATCHED_KEY}
          className="detail-pill"
          autoFocus={primaryDisabled}
          disabled={setWatched.isPending}
          onFocused={onFocused}
          onClick={() => markWatched(!watched.played)}
        >
          <Check size={28} aria-hidden="true" />
          {t(watched.label)}
        </Button>
        {hasHeartAndStars ? (
          <>
            <Button
              focusKey={FAVORITE_KEY}
              className="detail-pill detail-round"
              aria-label={t(favorite ? 'detail.unfavorite' : 'detail.favorite')}
              aria-pressed={favorite}
              onFocused={onFocused}
              onClick={() =>
                flag(
                  'is_favorite',
                  !favorite,
                  t(favorite ? 'detail.favoritesRemoved' : 'detail.favoritesAdded'),
                  t('detail.favoritesFailed'),
                )
              }
            >
              <Heart size={36} aria-hidden="true" className="detail-heart" data-filled={favorite} />
            </Button>
            <StarRating
              value={rating}
              picking={picking}
              onFocused={onFocused}
              onPress={() => (picking === null ? setPicking(rating ?? 1) : commitRating(picking))}
              onPickStar={commitRating}
              onBlur={() => setPicking(null)}
            />
          </>
        ) : null}
        {hasMenu ? (
          <Button
            focusKey={MENU_KEY}
            className="detail-pill detail-round"
            aria-label={t('detail.moreActions')}
            aria-haspopup="dialog"
            onFocused={onFocused}
            onClick={() => setDialog('menu')}
          >
            <EllipsisVertical size={36} aria-hidden="true" />
          </Button>
        ) : null}
        {hasTranslate ? (
          <Button
            focusKey={TRANSLATE_KEY}
            className="detail-pill"
            onFocused={onFocused}
            onClick={onTranslate}
          >
            {t('detail.translate')}
          </Button>
        ) : null}
      </FocusGroup>
      {pills ? <PillsRow pills={pills} onOpen={setDialog} onFocused={onPillsFocused} /> : null}
      {/* The dialogs render on the body: the page moves by a transform, which would make a fixed
          overlay inside it follow the page. Their host group never restores the focus by itself:
          when a dialog goes, the navigation would otherwise move the focus to the screen's first
          button a moment after the manual return to the button that opened it. */}
      {createPortal(
        <FocusGroup focusKey="detail-dialogs" autoRestoreFocus={false}>
          {dialog === 'resume' ? (
            <ChoiceDialog
              testId="resume-dialog"
              label={t('detail.resumeDialogTitle')}
              title={t('detail.resumeDialogTitle')}
              description={t('detail.resumeDescription', {
                time: formatClock(resumeAt),
                percent: Math.round(playedShare(resumeAt, totalSeconds) * 100),
              })}
              choices={[
                {
                  key: 'detail-resume-at',
                  label: t('detail.resumeAt', { time: formatClock(resumeAt) }),
                  onSelect: () => play({ kind: 'resume' }),
                },
                {
                  key: 'detail-resume-start-over',
                  label: t('detail.playFromBeginning'),
                  onSelect: () => play({ kind: 'beginning' }),
                },
              ]}
              onClose={closeDialog}
            />
          ) : null}
          {dialog === 'menu' ? (
            <ChoiceDialog
              testId="more-menu"
              label={t('detail.moreActions')}
              choices={menu}
              onClose={closeDialog}
            />
          ) : null}
          {pills && dialog !== null && dialog !== 'resume' && dialog !== 'menu' ? (
            <PillDialog kind={dialog} pills={pills} onClose={closeDialog} />
          ) : null}
        </FocusGroup>,
        document.body,
      )}
    </>
  );
}
