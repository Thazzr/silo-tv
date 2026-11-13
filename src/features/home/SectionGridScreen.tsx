import { useMemo } from 'react';
import type { StartIntent } from '../../playback/resume';
import { SiloApiError } from '../../api/problem';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import {
  Grid,
  GridSkeleton,
  PosterCard,
  type CatalogItem,
  type FocusIndexMemory,
} from '../../ui/media';
import type { DetailTarget } from '../detail/detailMemory';
import { useSectionPages } from './queries';
import { useItemOpener } from './useItemOpener';

export interface SectionGridScreenProps {
  sectionId: string;
  title: string;
  /** Set for a row of a library's Recommended view; Home's rows have none. */
  library?: { id: string; type?: string };
  /** The grid's focus survives the player being opened over it. */
  memory: FocusIndexMemory;
  onPlay: (item: CatalogItem, intent?: StartIntent) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onBack: () => void;
}

/**
 * The full list of one Home row ("Explore all"): its title above a virtualised grid of posters
 * that follows the server's cursor. Back returns to Home on the card that opened it.
 */
export function SectionGridScreen({
  sectionId,
  title,
  library,
  memory,
  onPlay,
  onOpenDetail,
  onBack,
}: SectionGridScreenProps) {
  const t = useT();
  const pages = useSectionPages(sectionId, library);
  const { open, play } = useItemOpener({ onPlay, onOpenDetail });
  const items = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);

  let body;
  if (pages.isPending) {
    body = <GridSkeleton />;
  } else if (pages.isError && items.length === 0) {
    const gone = pages.error instanceof SiloApiError && pages.error.status === 404;
    body = (
      <div className="home-message" role="alert" data-testid="grid-error">
        <p className="error">{t(gone ? 'home.grid.gone' : 'home.grid.error')}</p>
        <Button
          focusKey="grid-retry"
          autoFocus
          onClick={gone ? onBack : () => void pages.refetch()}
        >
          {t(gone ? 'home.grid.back' : 'common.retry')}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="home-message" data-testid="grid-empty">
        <p className="note">{t('home.grid.empty')}</p>
        <Button focusKey="grid-back" autoFocus onClick={onBack}>
          {t('home.grid.back')}
        </Button>
      </div>
    );
  } else {
    body = (
      <Grid
        gridId={library ? `${library.id}:${sectionId}` : sectionId}
        items={items}
        getKey={(item) => item.content_id}
        hasMore={pages.hasNextPage}
        loadingMore={pages.isFetchingNextPage}
        onLoadMore={() => void pages.fetchNextPage()}
        memory={memory}
        renderCard={(item, ctx) => (
          <PosterCard
            grid
            item={item}
            focusKey={ctx.focusKey}
            autoFocus={ctx.autoFocus}
            onFocused={ctx.onFocused}
            onOpen={open}
            onPlay={play}
          />
        )}
      />
    );
  }

  return (
    <main className="screen section-grid" data-testid="section-grid">
      <h1 className="section-grid-title" data-testid="section-grid-title">
        {title}
      </h1>
      {body}
    </main>
  );
}
