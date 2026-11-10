import { useT } from '../../i18n';
import { formatClock } from '../format';
import type { Chapter } from '../osd/previewMath';
import { MenuPopover, MenuRow } from './MenuPopover';

export const chapterKey = (index: number) => `player-menu-chapter-${index}`;

/** One row per chapter of the playing file: its title and start; the one that plays is marked. */
export function ChaptersMenu({
  chapters,
  current,
  onChoose,
  remember,
  recall,
  onSide,
}: {
  chapters: readonly Chapter[];
  /** Index of the chapter that plays, or -1. */
  current: number;
  /** Seeks to the chapter's start (source seconds) and closes the menu. */
  onChoose(start: number): void;
  remember(key: string): void;
  recall(): string | null;
  onSide(direction: 'left' | 'right'): void;
}) {
  const t = useT();
  return (
    <MenuPopover
      label={t('player.menu.chapters')}
      testId="chapters"
      rows={chapters.map((_, index) => chapterKey(index))}
      fallback={chapterKey(Math.max(0, current))}
      remember={remember}
      recall={recall}
      onSide={onSide}
    >
      <div role="menu" aria-label={t('player.menu.chapters')} data-testid="menu-chapters">
        {chapters.map((chapter, index) => (
          <MenuRow
            key={index}
            focusKey={chapterKey(index)}
            role="menuitem"
            aria-current={index === current ? 'true' : undefined}
            data-current={index === current}
            onClick={() => onChoose(chapter.start)}
          >
            <span className="player-menu-row-name">
              {chapter.title.trim() || t('player.menu.chapterN', { n: index + 1 })}
            </span>
            <span className="menu-value">{formatClock(chapter.start)}</span>
          </MenuRow>
        ))}
      </div>
    </MenuPopover>
  );
}
