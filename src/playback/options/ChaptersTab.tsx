import { Focusable } from '../../app/nav';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import type { Chapter } from '../osd/previewMath';

export const chapterKey = (index: number) => `player-opt-chapter-${index}`;

/** One row per chapter of the playing file: its title and start; the one that plays is marked. */
export function ChaptersTab({
  chapters,
  current,
  onChoose,
  onFocusKey,
}: {
  chapters: readonly Chapter[];
  /** Index of the chapter that plays, or -1. */
  current: number;
  /** Seeks to the chapter's start (source seconds) and leaves the panel. */
  onChoose(start: number): void;
  onFocusKey(key: string): void;
}) {
  const t = useT();
  return (
    <div role="menu" aria-label={t('player.options.tab.chapters')} data-testid="options-chapters">
      {chapters.map((chapter, index) => (
        <Focusable
          key={index}
          focusKey={chapterKey(index)}
          role="menuitem"
          aria-current={index === current ? 'true' : undefined}
          data-current={index === current}
          className="menu-item menu-item-split player-options-row"
          onFocused={() => onFocusKey(chapterKey(index))}
          onClick={() => onChoose(chapter.start)}
        >
          <span className="player-options-row-name">
            {chapter.title.trim() || t('player.options.chapterN', { n: index + 1 })}
          </span>
          <span className="menu-value">{formatClock(chapter.start)}</span>
        </Focusable>
      ))}
    </div>
  );
}
