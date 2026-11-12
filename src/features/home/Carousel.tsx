import { memo, useCallback, useEffect, useState } from 'react';
import { Info, Pause, Play } from 'lucide-react';
import { FocusGroup, Focusable, moveFocusTo, type ArrowDirection } from '../../app/nav';
import { Button } from '../../app/ui';
import { useLanguage, useT, type MessageKey } from '../../i18n';
import {
  cardTitle,
  heroProtection,
  thumbhashPreview,
  useMediaUrl,
  useSpoilerSettings,
  type CatalogItem,
} from '../../ui/media';
import { onPlayKey } from '../detail/playKey';
import { heroMeta } from './heroMeta';

/** How long a slide stays before the next one fades in. */
export const CAROUSEL_TURN_MS = 8000;
/** How long the crossfade between two slides takes (the stylesheet's `.hero-slide` transition). */
export const CAROUSEL_FADE_MS = 1000;

export const HERO_KEY = 'hero';
export const HERO_PLAY_KEY = 'hero-play';
export const HERO_INFO_KEY = 'hero-info';
export const HERO_PAGER_KEY = 'hero-pager';
export const HERO_RETRY_KEY = 'hero-retry';
const HERO_BUTTONS_KEY = 'hero-buttons';

const twoDigits = (n: number) => String(n).padStart(2, '0');

interface State {
  index: number;
  /** The slide that is fading out, with a number that tells two fades of the same slide apart. */
  outgoing: { index: number; id: number } | null;
  /** The viewer paused the slideshow (the indicator, OK). */
  paused: boolean;
  /** Bumped whenever the 8 s start afresh without a new slide, so the indicator's rail restarts. */
  cycle: number;
}

/** The backdrop a slide shows: the series' for an episode, a blurred stand-in when it would spoil. */
function useSlideArt() {
  const url = useMediaUrl();
  const spoilers = useSpoilerSettings();
  return (item: CatalogItem): string | null => {
    const hidden = heroProtection(item, spoilers).hideBackdrop;
    if (hidden) return thumbhashPreview(item.backdrop_thumbhash);
    const episode = item.type.trim().toLowerCase() === 'episode';
    return url(
      (episode ? (item.series_backdrop_url ?? item.backdrop_url) : item.backdrop_url) ?? undefined,
    );
  };
}

function Slide({ src, active }: { src: string | null; active: boolean }) {
  // The picture fades in when it has loaded; a slide preloaded behind the active one is already there.
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="hero-slide" data-testid="hero-slide" data-active={active}>
      {src ? (
        <img
          className="hero-slide-img"
          data-loaded={loaded}
          src={src}
          alt=""
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </div>
  );
}

/**
 * The featured carousel: the slides' backdrops crossfading, the title, meta line and synopsis of
 * the one shown, "Play" and "More Info", and the slide indicator. A slide turns after 8 s while
 * the carousel is `shown` and the focus is not on its two buttons; the indicator pages with
 * Left and Right and pauses with OK. Only the backdrops of the active, the fading out and the
 * next slide are loaded. It is memoised: while the focus runs along the rows below, the hero
 * re-renders on every card, and the carousel (hidden then) must not follow.
 */
export const Carousel = memo(function Carousel({
  slides,
  shown,
  onPlay,
  onOpen,
}: {
  slides: readonly CatalogItem[];
  /** Whether the carousel is what the hero shows (not the card the focus is on in the rows). */
  shown: boolean;
  onPlay: (item: CatalogItem) => void;
  onOpen: (item: CatalogItem) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const artOf = useSlideArt();
  const spoilers = useSpoilerSettings();
  const count = slides.length;
  const [state, setState] = useState<State>({ index: 0, outgoing: null, paused: false, cycle: 0 });
  const [onButtons, setOnButtons] = useState(false);
  // Fewer slides than before (the section was read again): stay on the last one.
  const index = Math.min(state.index, count - 1);
  const active = shown && !state.paused && !onButtons && count > 1;

  // Every start of the 8 s (also after a pause or after the focus left the buttons) restarts the rail.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setState((s) => ({ ...s, cycle: s.cycle + 1 }));
  }

  const turn = useCallback(
    (by: number) =>
      setState((s) => {
        const from = Math.min(s.index, count - 1);
        const to = (((from + by) % count) + count) % count;
        return {
          ...s,
          index: to,
          outgoing: { index: from, id: (s.outgoing?.id ?? 0) + 1 },
        };
      }),
    [count],
  );

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => turn(1), CAROUSEL_TURN_MS);
    return () => clearTimeout(id);
  }, [active, index, turn]);

  const fadingId = state.outgoing?.id;
  useEffect(() => {
    if (fadingId === undefined) return;
    const id = setTimeout(() => setState((s) => ({ ...s, outgoing: null })), CAROUSEL_FADE_MS);
    return () => clearTimeout(id);
  }, [fadingId]);

  const arrow = useCallback(
    (direction: ArrowDirection, fromKey: string) => {
      if (fromKey === HERO_PAGER_KEY) {
        if (direction === 'left' || direction === 'right') {
          turn(direction === 'left' ? -1 : 1);
          return true;
        }
        return false;
      }
      if (fromKey === HERO_PLAY_KEY && direction === 'right') return moveFocusTo(HERO_INFO_KEY);
      if (fromKey === HERO_INFO_KEY) {
        if (direction === 'left') return moveFocusTo(HERO_PLAY_KEY);
        if (direction === 'right') return moveFocusTo(HERO_PAGER_KEY);
      }
      return false;
    },
    [turn],
  );

  const current = slides[index]!;
  const hidden = heroProtection(current, spoilers);
  const meta = heroMeta(current, { t, lang });
  // The slides whose pictures are loaded: the active one, the one fading out, and the next.
  const kept = new Set([index, state.outgoing?.index, (index + 1) % count]);

  return (
    <div
      className="hero-carousel"
      data-testid="hero-carousel"
      data-shown={shown}
      role="group"
      aria-roledescription="carousel"
      aria-label={t('hero.carousel')}
      onKeyDown={onPlayKey(() => onPlay(current))}
    >
      {slides.map((slide, i) =>
        kept.has(i) ? (
          <Slide key={slide.content_id} src={artOf(slide)} active={i === index} />
        ) : null,
      )}
      <div className="hero-dim" aria-hidden="true" />
      <div className="hero-fade-bottom" aria-hidden="true" />
      <div className="hero-fade-left" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />
      <div className="hero-top-scrim" aria-hidden="true" />
      <FocusGroup
        focusKey={HERO_KEY}
        enterable
        saveLastFocusedChild
        preferredChildFocusKey={HERO_PLAY_KEY}
        onArrow={arrow}
        className="hero-controls"
      >
        <div className="hero-text">
          <h2 className="hero-title" data-testid="hero-title">
            {cardTitle(current)}
          </h2>
          {meta ? (
            <p className="hero-meta" data-testid="hero-meta">
              {meta}
            </p>
          ) : null}
          {current.overview && !hidden.hideOverview ? (
            <p className="hero-synopsis" data-testid="hero-synopsis">
              {current.overview}
            </p>
          ) : null}
          <FocusGroup
            focusKey={HERO_BUTTONS_KEY}
            enterable
            saveLastFocusedChild
            preferredChildFocusKey={HERO_PLAY_KEY}
            onFocusWithin={setOnButtons}
            className="hero-actions"
          >
            <Focusable
              focusKey={HERO_PLAY_KEY}
              className="hero-btn hero-btn-primary"
              onClick={() => onPlay(current)}
            >
              <Play aria-hidden="true" fill="currentColor" size={26} />
              {t('hero.play')}
            </Focusable>
            <Focusable
              focusKey={HERO_INFO_KEY}
              className="hero-btn"
              onClick={() => onOpen(current)}
            >
              <Info aria-hidden="true" size={26} />
              {t('hero.moreInfo')}
            </Focusable>
          </FocusGroup>
        </div>
        {count > 1 ? (
          <Focusable
            focusKey={HERO_PAGER_KEY}
            className="hero-pager"
            aria-label={state.paused ? t('hero.playSlideshow') : t('hero.pauseSlideshow')}
            onClick={() => setState((s) => ({ ...s, paused: !s.paused }))}
          >
            <span className="hero-counter" aria-hidden="true">
              <span data-testid="hero-slide-number">{twoDigits(index + 1)}</span>
              <span className="hero-counter-line" />
              <span data-testid="hero-slide-count">{twoDigits(count)}</span>
            </span>
            <span className="hero-rail" data-paused={!active} aria-hidden="true">
              <span key={`${index}-${state.cycle}`} data-testid="hero-rail-fill" />
            </span>
            {state.paused ? (
              <Play aria-hidden="true" fill="currentColor" size={22} />
            ) : (
              <Pause aria-hidden="true" fill="currentColor" size={22} />
            )}
          </Focusable>
        ) : null}
      </FocusGroup>
    </div>
  );
});

/** The panel in the hero's place when the featured section could not be read: "Retry section". */
export function HeroError({ text, onRetry }: { text: MessageKey; onRetry: () => void }) {
  const t = useT();
  return (
    <FocusGroup
      focusKey={HERO_KEY}
      enterable
      className="hero-error"
      role="alert"
      data-testid="hero-error"
    >
      <p className="error">{t(text)}</p>
      <Button focusKey={HERO_RETRY_KEY} onClick={onRetry}>
        {t('hero.retry')}
      </Button>
    </FocusGroup>
  );
}
