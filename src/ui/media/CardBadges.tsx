import {
  Building2,
  Check,
  Clock,
  Film,
  Globe,
  LayoutTemplate,
  Languages,
  Monitor,
  Shield,
  Subtitles,
  Tv,
  Users,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '../../i18n';
import { BADGE_POSITIONS, cardBadges, type BadgeGlyph, type BadgePosition } from './badges';
import type { CatalogItem } from './cardInfo';
import { useCardBadgePrefs } from './useCardBadges';

const GLYPH_ICONS: Record<BadgeGlyph, LucideIcon> = {
  monitor: Monitor,
  volume: Volume2,
  film: Film,
  layout: LayoutTemplate,
  languages: Languages,
  subtitles: Subtitles,
  shield: Shield,
  users: Users,
  clock: Clock,
  globe: Globe,
  building: Building2,
  tv: Tv,
};

/**
 * The profile's overlay badges on a card's art: stacks in the corners and rails on the edges, drawn
 * in one look (a dark pill with a light edge, tinted with the badge's accent). Decoration only:
 * not focusable and hidden from assistive technology, the card's own name stays what it was.
 * `raised` lifts the bottom stacks above the progress bar; `without` leaves a position to
 * something else on the card (a label in its top-left corner).
 */
export function CardBadges({
  item,
  raised = false,
  without,
}: {
  item: CatalogItem;
  raised?: boolean;
  without?: BadgePosition;
}) {
  const t = useT();
  const lang = useLanguage();
  const prefs = useCardBadgePrefs();
  if (prefs === null) return null;
  const badges = cardBadges(item, prefs, { t, lang });
  const positions = BADGE_POSITIONS.filter(
    (position) => position !== without && badges[position].length > 0,
  );
  if (positions.length === 0) return null;
  const split = positions.includes('bottom-left') && positions.includes('bottom-right');
  return (
    <span
      className={`card-badges${raised ? ' card-badges-raised' : ''}${split ? ' card-badges-split' : ''}`}
      aria-hidden="true"
    >
      {positions.map((position) => (
        <span key={position} className={`badge-stack badge-stack-${position}`}>
          {badges[position].map((badge) => (
            <span
              key={badge.id}
              className="badge"
              data-testid="card-badge"
              data-badge={badge.id}
              style={
                badge.accent
                  ? { backgroundImage: `linear-gradient(${badge.accent}47, ${badge.accent}47)` }
                  : undefined
              }
            >
              {badge.glyph ? <GlyphIcon glyph={badge.glyph} /> : null}
              <span className="badge-text">{badge.text}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function GlyphIcon({ glyph }: { glyph: BadgeGlyph }) {
  const Icon = GLYPH_ICONS[glyph];
  return <Icon className="badge-glyph" data-glyph={glyph} size={20} aria-hidden="true" />;
}

/** The watch state an item's card shows: nothing for an item without watch data. */
export function ItemWatchStatus({ item }: { item: CatalogItem }) {
  const state = item.user_state;
  if (!state) return null;
  return (
    <WatchStatus
      played={state.played}
      watchedCount={state.watched_count}
      unplayedCount={state.unplayed_count}
    />
  );
}

/**
 * The watch state in the top-right corner of a card, whether or not badges are on: a green check
 * for something watched, or a dark disc with the episodes a started series or season has left. An
 * untouched series shows nothing.
 */
export function WatchStatus({
  played,
  watchedCount,
  unplayedCount,
}: {
  played: boolean;
  watchedCount?: number;
  unplayedCount?: number;
}) {
  const t = useT();
  if (played) {
    return (
      <span
        className="watch-status watch-status-done"
        data-testid="watch-status-done"
        role="img"
        aria-label={t('detail.watched')}
      >
        <Check size={26} strokeWidth={3.25} aria-hidden="true" />
      </span>
    );
  }
  const left = (watchedCount ?? 0) > 0 ? (unplayedCount ?? 0) : 0;
  if (left <= 0) return null;
  return (
    <span
      className="watch-status watch-status-left"
      data-testid="watch-status-left"
      role="img"
      aria-label={left === 1 ? t('card.episodeLeftOne') : t('card.episodesLeft', { count: left })}
    >
      {left}
    </span>
  );
}
