import { Button, ErrorState, ListSkeleton } from '../../app/ui';
import { useT, type MessageKey } from '../../i18n';
import type { DetailTarget } from '../detail/detailMemory';
import { useItemOpener } from '../home/useItemOpener';
import { useFirstLibrary, type CatalogItem, type LibraryKind } from './queries';

const NO_LIBRARY_TEXT: Record<LibraryKind, MessageKey> = {
  video: 'library.noLibrary',
  movie: 'library.noMovies',
  series: 'library.noSeries',
};

/**
 * The Phase 0 title list of the first library of a kind, as the content of a shell tab. It never
 * takes the focus by itself: the tab bar keeps it until the user moves down into the list.
 */
export function TitleList({
  kind = 'video',
  onPlay,
  onOpenDetail,
}: {
  kind?: LibraryKind;
  /** Opens the player for a title; the screen stack keeps the shell underneath. */
  onPlay: (item: CatalogItem) => void;
  /** Opens the detail page of a movie or series. */
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const t = useT();
  const { library, items, isLoading, isError, noLibrary, retry } = useFirstLibrary(kind);
  const { open } = useItemOpener({ onPlay, onOpenDetail });

  let body;
  if (isLoading) {
    body = <ListSkeleton label={t('library.loading')} />;
  } else if (isError) {
    body = <ErrorState message={t('library.error')} onRetry={retry} />;
  } else if (noLibrary) {
    body = <p className="note">{t(NO_LIBRARY_TEXT[kind])}</p>;
  } else if (items?.length === 0) {
    body = <p className="note">{t('library.empty')}</p>;
  } else {
    body = (
      <ul className="list" data-testid="title-list">
        {items?.map((item) => (
          <li key={item.content_id}>
            <Button
              focusKey={`title-${item.content_id}`}
              className="row"
              onClick={() => open(item)}
            >
              <span className="grow">{item.title}</span>
              {item.year ? <span className="year">{item.year}</span> : null}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section data-testid="library-screen">
      <h2 className="section-title">{library?.name ?? t('library.title')}</h2>
      {body}
    </section>
  );
}
