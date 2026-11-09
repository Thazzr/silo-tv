import { useMemo } from 'react';
import { Button } from '../../app/ui';
import { useT } from '../../i18n';
import { Artwork, CardFrame, Grid, GridSkeleton, useMediaUrl } from '../../ui/media';
import type { LibraryMemory } from './libraryMemory';
import {
  isMixed,
  useLibraryCollections,
  type CollectionCard,
  type LibraryKind,
  type UserLibrary,
} from './queries';
import type { CollectionTarget } from './targets';

/** A collection as a grid poster: its picture over its title and the number of titles in it. */
function CollectionPoster({
  card,
  focusKey,
  onFocused,
  onOpen,
}: {
  card: CollectionCard;
  focusKey: string;
  onFocused: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  const url = useMediaUrl();
  return (
    <CardFrame
      focusKey={focusKey}
      variant="grid"
      onClick={onOpen}
      onFocused={onFocused}
      art={
        <Artwork src={url(card.poster_url)} thumbhash={card.poster_thumbhash} title={card.title} />
      }
      caption={
        <>
          <span className="card-title" data-testid="card-title">
            {card.title}
          </span>
          <span className="card-sub" data-testid="card-sub">
            {card.item_count === 1
              ? t('library.collections.one')
              : t('library.collections.many', { count: card.item_count })}
          </span>
        </>
      }
    />
  );
}

/**
 * A library's Collections view: every collection as a poster in one grid, in the server's order.
 * OK opens the collection's own page. It never takes the focus by itself.
 */
export function CollectionsView({
  library,
  kind,
  memory,
  onOpenCollection,
}: {
  library: UserLibrary;
  kind: LibraryKind;
  memory: LibraryMemory;
  onOpenCollection: (target: CollectionTarget) => void;
}) {
  const t = useT();
  const query = useLibraryCollections(library.id);
  // A collection without a title in it has nothing to open.
  const cards = useMemo(
    () => query.data?.cards.filter((card) => card.item_count > 0) ?? [],
    [query.data],
  );

  if (query.isPending) return <GridSkeleton />;
  if (query.isError) {
    return (
      <div className="library-message" role="alert" data-testid="collections-error">
        <p className="error">{t('library.collections.error')}</p>
        <Button focusKey="collections-retry" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="library-message" data-testid="collections-empty">
        <p className="note">{t('library.collections.empty')}</p>
      </div>
    );
  }
  return (
    <div className="collections" data-testid="collections">
      <Grid
        gridId={`collections:${library.id}`}
        items={cards}
        getKey={(card) => card.id}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
        memory={memory.indices}
        renderCard={(card, ctx) => (
          <CollectionPoster
            card={card}
            focusKey={ctx.focusKey}
            onFocused={ctx.onFocused}
            onOpen={() =>
              onOpenCollection({
                libraryId: library.id,
                collectionId: card.id,
                title: card.title,
                type: isMixed(library) ? kind : undefined,
              })
            }
          />
        )}
      />
    </div>
  );
}
