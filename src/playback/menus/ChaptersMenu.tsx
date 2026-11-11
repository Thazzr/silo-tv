import { useState } from 'react';
import { Film } from 'lucide-react';
import { useSilo } from '../../app/SiloContext';
import { useT } from '../../i18n';
import { formatClock } from '../format';
import { resolveSheetUrl, type Chapter } from '../osd/previewMath';
import { MenuPopover, MenuRow } from './MenuPopover';

export const chapterKey = (index: number) => `player-menu-chapter-${index}`;

/**
 * The chapter's picture, which the server renders and names by an opaque URL: loaded as given,
 * like the scrub sheets. A chapter without one, or whose picture fails, shows a film glyph on a
 * plain box of the same size.
 */
function ChapterThumb({ url }: { url: string | null }) {
  // Only a failure is state: a picture that loads needs no re-render.
  const [failed, setFailed] = useState(false);
  if (url === null || failed) {
    return (
      <span className="player-chapter-thumb player-chapter-placeholder" data-testid="chapter-thumb">
        <Film size={32} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="player-chapter-thumb" data-testid="chapter-thumb">
      <img src={url} alt="" decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}

/**
 * One row per chapter of the playing file, as Silo's web player lists them: its picture, title and
 * start. The chapter that plays has the lighter background; OK seeks to a chapter's start.
 */
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
  const { baseUrl } = useSilo();
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
      <p className="player-menu-heading">{t('player.menu.chapters')}</p>
      <div role="menu" aria-label={t('player.menu.chapters')} data-testid="menu-chapters">
        {chapters.map((chapter, index) => (
          <MenuRow
            key={index}
            focusKey={chapterKey(index)}
            className="player-menu-chapter"
            role="menuitem"
            aria-current={index === current ? 'true' : undefined}
            data-current={index === current}
            onClick={() => onChoose(chapter.start)}
          >
            <ChapterThumb
              key={chapter.thumbnailUrl}
              url={chapter.thumbnailUrl ? resolveSheetUrl(chapter.thumbnailUrl, baseUrl) : null}
            />
            <span className="player-chapter-text">
              <span className="player-menu-row-name">
                {chapter.title.trim() || t('player.menu.chapterN', { n: index + 1 })}
              </span>
              <span className="player-menu-meta">{formatClock(chapter.start)}</span>
            </span>
          </MenuRow>
        ))}
      </div>
    </MenuPopover>
  );
}
