import { FocusGroup, Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import type { Season } from './info';

export const seasonKey = (season: number) => `season:${season}`;

/**
 * The seasons as a row of pills (numbered seasons in order, Specials last). Focus and hover only
 * move the highlight; OK or a click shows a season (`onPick`). Entering the row from the episodes
 * lands on the selected season.
 */
export function SeasonPills({
  seasons,
  selected,
  onPick,
  onFocused,
}: {
  /** In display order. */
  seasons: readonly Season[];
  selected: number | undefined;
  onPick: (season: number) => void;
  onFocused: () => void;
}) {
  const t = useT();
  return (
    <FocusGroup
      focusKey="detail-seasons"
      enterable
      saveLastFocusedChild={false}
      preferredChildFocusKey={selected === undefined ? undefined : seasonKey(selected)}
      className="detail-row detail-seasons"
      role="tablist"
      aria-label={t('detail.seasons')}
      data-testid="season-pills"
    >
      {seasons.map((season) => {
        const specials = season.is_specials === true || season.season_number === 0;
        return (
          <Focusable
            key={season.season_number}
            focusKey={seasonKey(season.season_number)}
            className={`btn detail-pill detail-season${season.season_number === selected ? ' selected' : ''}`}
            role="tab"
            aria-selected={season.season_number === selected}
            onFocused={() => {
              onFocused();
            }}
            onClick={() => onPick(season.season_number)}
          >
            {specials ? t('detail.specials') : t('detail.season', { number: season.season_number })}
          </Focusable>
        );
      })}
    </FocusGroup>
  );
}
