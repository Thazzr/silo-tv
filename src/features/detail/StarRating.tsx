import { Star } from 'lucide-react';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';

export const RATING_KEY = 'detail-rating';
export const MAX_STARS = 5;

/**
 * The star rating of a title: five whole stars in one button, so the group is the focus target.
 * OK starts picking (the action row's arrow handler then steps `picking` with Left and Right and
 * the stars light up as it goes); the pointer saves the star it clicks.
 */
export function StarRating({
  value,
  picking,
  onFocused,
  onPress,
  onPickStar,
  onBlur,
}: {
  /** The saved rating, 1 to 5, or null for none. */
  value: number | null;
  /** The star being picked (0 to 5), or null outside picking: then `value` is drawn. */
  picking: number | null;
  onFocused: () => void;
  /** OK (or any click that is not on a star). */
  onPress: () => void;
  /** A pointer click on star `n`. */
  onPickStar: (n: number) => void;
  /** The focus left the group: picking ends. */
  onBlur: () => void;
}) {
  const t = useT();
  const shown = picking ?? value ?? 0;
  const label =
    value === null
      ? t('detail.rating')
      : value === 1
        ? t('detail.ratingOne')
        : t('detail.ratingMany', { n: value });
  return (
    <Button
      focusKey={RATING_KEY}
      className="detail-pill detail-stars"
      aria-label={label}
      data-picking={picking !== null}
      onFocused={onFocused}
      onBlur={onBlur}
      onClick={(event) => {
        const star = (event.target as Element).closest('[data-star]')?.getAttribute('data-star');
        // The remote's OK clicks the button itself; the pointer clicks a star.
        if (star) onPickStar(Number(star));
        else onPress();
      }}
    >
      {Array.from({ length: MAX_STARS }, (_, index) => (
        <Star
          key={index}
          size={36}
          strokeWidth={1.5}
          aria-hidden="true"
          data-star={index + 1}
          data-filled={index < shown}
          className="detail-star"
        />
      ))}
    </Button>
  );
}
