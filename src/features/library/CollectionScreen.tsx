import { useMemo } from 'react';
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
import { useItemOpener } from '../home/useItemOpener';
import { useCollectionPages, useLibraryCollections } from './queries';
import type { CollectionTarget } from './targets';

export interface CollectionScreenProps {
  target: CollectionTarget;
  /** The grid's focus survives the player and the detail page being opened over it. */
  memory: FocusIndexMemory;
  onPlay: (item: CatalogItem) => void;
  onOpenDetail: (target: DetailTarget) => void;
  onBack: () => void;
}

/**
 * One collection of a library, read-only: its title and description above a poster grid of its
 * titles in the server's order. Back returns to the Collections view on the poster that opened it.
 */
export function CollectionScreen({
  target,
  memory,
  onPlay,
  onOpenDetail,
  onBack,
}: CollectionScreenProps) {
  const t = useT();
  const pages = useCollectionPages(target.libraryId, target.collectionId);
  // The index of the library is already read for the view that opened this page.
  const collections = useLibraryCollections(target.libraryId);
  const { open } = useItemOpener({ onPlay, onOpenDetail });
  const description = collections.data?.descriptions.get(target.collectionId);
  const title =
    collections.data?.cards.find((card) => card.id === target.collectionId)?.title ?? target.title;
  const items = useMemo(
    () =>
      (pages.data?.pages.flatMap((page) => page.items) ?? []).filter(
        // A mixed library's collection holds both kinds; the tab that opened it shows its own.
        (item) => !target.type || item.type.trim().toLowerCase() === target.type,
      ),
    [pages.data, target.type],
  );

  let body;
  if (pages.isPending) {
    body = <GridSkeleton />;
  } else if (pages.isError && items.length === 0) {
    const gone = pages.error instanceof SiloApiError && pages.error.status === 404;
    body = (
      <div className="home-message" role="alert" data-testid="collection-error">
        <p className="error">{t(gone ? 'library.collection.gone' : 'library.error')}</p>
        <Button
          focusKey="collection-retry"
          autoFocus
          onClick={gone ? onBack : () => void pages.refetch()}
        >
          {t(gone ? 'library.collection.back' : 'common.retry')}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="home-message" data-testid="collection-empty">
        <p className="note">{t('library.collection.empty')}</p>
        <Button focusKey="collection-back" autoFocus onClick={onBack}>
          {t('library.collection.back')}
        </Button>
      </div>
    );
  } else {
    const gridId = `collection:${target.libraryId}:${target.collectionId}`;
    body = (
      <Grid
        gridId={gridId}
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
          />
        )}
      />
    );
  }

  return (
    <main className="screen section-grid collection-page" data-testid="collection-page">
      <div className="collection-head">
        <h1 className="section-grid-title" data-testid="collection-title">
          {title}
        </h1>
        {description ? (
          <p className="collection-description" data-testid="collection-description">
            {description}
          </p>
        ) : null}
      </div>
      {body}
    </main>
  );
}
